"""
Photo import script. Run repeatedly as an inbox processor — each run ingests
whatever is in SOURCE_FOLDERS and leaves them empty.
"""

import hashlib
import os
import shutil
import time
from datetime import datetime

from flask import Flask

import config
import tagger
from models import db, Photo, Tag

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic"}

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = config.SQLALCHEMY_DATABASE_URI
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)


def md5(filepath):
    h = hashlib.md5()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_exif(filepath):
    """Return (date_taken, latitude, longitude); any value may be None on failure."""
    date_taken = None
    latitude = None
    longitude = None
    try:
        import exifread

        with open(filepath, "rb") as f:
            tags = exifread.process_file(f, details=False)

        for key in ("EXIF DateTimeOriginal", "EXIF DateTimeDigitized", "Image DateTime"):
            if key in tags:
                try:
                    date_taken = datetime.strptime(str(tags[key]), "%Y:%m:%d %H:%M:%S")
                    break
                except ValueError:
                    pass

        def ratio_to_decimal(values):
            d = float(values[0].num) / float(values[0].den)
            m = float(values[1].num) / float(values[1].den)
            s = float(values[2].num) / float(values[2].den)
            return d + m / 60 + s / 3600

        if "GPS GPSLatitude" in tags and "GPS GPSLatitudeRef" in tags:
            lat = ratio_to_decimal(tags["GPS GPSLatitude"].values)
            if str(tags["GPS GPSLatitudeRef"]).strip() == "S":
                lat = -lat
            latitude = lat

        if "GPS GPSLongitude" in tags and "GPS GPSLongitudeRef" in tags:
            lon = ratio_to_decimal(tags["GPS GPSLongitude"].values)
            if str(tags["GPS GPSLongitudeRef"]).strip() == "W":
                lon = -lon
            longitude = lon

    except Exception:
        pass

    return date_taken, latitude, longitude


def destination_path(dest_folder, filename):
    """
    Return a path in dest_folder for filename that does not already exist.
    If the name is taken, append _1, _2, ... until a free slot is found.
    """
    candidate = os.path.join(dest_folder, filename)
    if not os.path.exists(candidate):
        return candidate
    stem, ext = os.path.splitext(filename)
    counter = 1
    while True:
        candidate = os.path.join(dest_folder, f"{stem}_{counter}{ext}")
        if not os.path.exists(candidate):
            return candidate
        counter += 1


def remove_empty_dirs(root):
    """Remove empty subdirectories inside root (bottom-up). Returns count removed."""
    removed = 0
    for dirpath, dirnames, filenames in os.walk(root, topdown=False):
        if dirpath == root:
            continue
        try:
            os.rmdir(dirpath)
            removed += 1
        except OSError:
            pass
    return removed


def collect_files(source_folders):
    files = []
    for folder in source_folders:
        if not os.path.isdir(folder):
            print(f"Warning: source folder not found, skipping: {folder}")
            continue
        for dirpath, _, filenames in os.walk(folder):
            for name in filenames:
                files.append(os.path.join(dirpath, name))
    return files


def format_size(num_bytes):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if num_bytes < 1024:
            return f"{num_bytes:.1f} {unit}"
        num_bytes /= 1024
    return f"{num_bytes:.1f} PB"


def print_run_summary(imported, duplicates, tag_updates, rejected, folders_removed, elapsed):
    print("\n" + "=" * 50)
    print("RUN SUMMARY")
    print("=" * 50)
    print(f"  New photos imported:       {imported}")
    print(f"  Duplicates found:          {duplicates}")
    if tag_updates:
        print(f"    (tag updates applied:    {tag_updates})")
    print(f"  Non-image files deleted:   {rejected}")
    print(f"  Empty folders removed:     {folders_removed}")
    print(f"  Time taken:                {elapsed:.1f}s")


def print_db_summary():
    from sqlalchemy import func
    from models import PhotoTag

    print("\n" + "=" * 50)
    print("DATABASE OVERVIEW")
    print("=" * 50)

    total_photos = Photo.query.count()
    print(f"  Total photos:              {total_photos}")

    # Total size of files in processed_photos
    total_bytes = 0
    if os.path.isdir(config.DESTINATION_FOLDER):
        for entry in os.scandir(config.DESTINATION_FOLDER):
            if entry.is_file():
                total_bytes += entry.stat().st_size
    print(f"  Total size (processed):    {format_size(total_bytes)}")

    total_tags = Tag.query.count()
    print(f"  Unique tags:               {total_tags}")

    # Most common tags
    top_tags = (
        db.session.query(Tag.name, Tag.tag_type, func.count(PhotoTag.photo_id).label("cnt"))
        .join(PhotoTag, PhotoTag.tag_id == Tag.id)
        .group_by(Tag.id)
        .order_by(func.count(PhotoTag.photo_id).desc())
        .limit(10)
        .all()
    )
    if top_tags:
        print("\n  Most common tags:")
        for name, tag_type, cnt in top_tags:
            print(f"    [{tag_type:8}] {name} — {cnt} photo{'s' if cnt != 1 else ''}")

    # Date range
    earliest = db.session.query(func.min(Photo.date_taken)).scalar()
    latest = db.session.query(func.max(Photo.date_taken)).scalar()
    no_date = Photo.query.filter(Photo.date_taken.is_(None)).count()
    if earliest and latest:
        print(f"\n  Date range:                {earliest.date()} → {latest.date()}")
    else:
        print(f"\n  Date range:                no dated photos")
    print(f"  Photos missing EXIF date:  {no_date}")

    # GPS coverage
    with_gps = Photo.query.filter(Photo.latitude.isnot(None)).count()
    print(f"  Photos with GPS data:      {with_gps}")
    print("=" * 50)


def main():
    start = time.monotonic()
    os.makedirs(config.DESTINATION_FOLDER, exist_ok=True)

    all_files = collect_files(config.SOURCE_FOLDERS)
    total = len(all_files)
    print(f"Found {total} file(s) to process.\n")

    imported = duplicates = rejected = tag_updates = 0

    for i, filepath in enumerate(all_files, 1):
        basename = os.path.basename(filepath)
        ext = os.path.splitext(basename)[1].lower()
        prefix = f"[{i}/{total}] {basename}"

        if ext not in SUPPORTED_EXTENSIONS:
            os.remove(filepath)
            rejected += 1
            print(f"{prefix} — rejected (unsupported type)")
            continue

        file_hash = md5(filepath)
        existing = Photo.query.filter_by(file_hash=file_hash).first()

        if existing:
            added = tagger.apply_tags_to_photo(existing, [tagger.generate_source_tag(filepath)], db.session)
            if added:
                db.session.commit()
                tag_updates += added
            os.remove(filepath)
            duplicates += 1
            print(f"{prefix} — duplicate of '{existing.filename}'")
            continue

        # New photo
        dest = destination_path(config.DESTINATION_FOLDER, basename)
        dest_filename = os.path.basename(dest)

        shutil.copy2(filepath, dest)

        date_taken, latitude, longitude = extract_exif(filepath)

        photo = Photo(
            filename=dest_filename,
            filepath=dest,
            file_hash=file_hash,
            date_taken=date_taken,
            latitude=latitude,
            longitude=longitude,
        )
        db.session.add(photo)
        db.session.flush()

        tags = [tagger.generate_source_tag(filepath)]
        tags += tagger.generate_date_tags(date_taken)
        tags += tagger.generate_location_tags(latitude, longitude)
        tagger.apply_tags_to_photo(photo, tags, db.session)
        db.session.commit()

        os.remove(filepath)
        imported += 1

        renamed = f" (renamed from {basename})" if dest_filename != basename else ""
        exif_info = f", date={date_taken.date()}" if date_taken else ""
        gps_info = f", gps=({latitude:.4f},{longitude:.4f})" if latitude is not None else ""
        print(f"{prefix} — imported{renamed}{exif_info}{gps_info}")

    folders_removed = 0
    for folder in config.SOURCE_FOLDERS:
        if os.path.isdir(folder):
            folders_removed += remove_empty_dirs(folder)

    elapsed = time.monotonic() - start
    print_run_summary(imported, duplicates, tag_updates, rejected, folders_removed, elapsed)
    print_db_summary()


if __name__ == "__main__":
    with app.app_context():
        main()
