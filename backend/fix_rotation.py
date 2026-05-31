"""
One-time script: applies EXIF auto-rotation to all photos in processed_photos.

For each photo that needs rotation:
  - Corrects and overwrites the file in processed_photos
  - Deletes the cached thumbnail so it regenerates on next view
  - Updates file_hash in the database to match the corrected file

Photos that are already correctly oriented are skipped without any changes.
"""

import hashlib
import os
import time

from flask import Flask
from PIL import Image

import config
from models import db, Photo
from rotate_utils import auto_rotate

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = config.SQLALCHEMY_DATABASE_URI
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)

THUMBNAIL_DIR = os.path.join(config.BASE_DIR, "thumbnails")


def md5(filepath):
    h = hashlib.md5()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    start = time.monotonic()
    photos = Photo.query.all()
    total = len(photos)
    print(f"Checking {total} photo(s) for EXIF rotation issues.\n")

    rotated = skipped = errors = 0

    for i, photo in enumerate(photos, 1):
        prefix = f"[{i}/{total}] {photo.filename}"

        if not os.path.exists(photo.filepath):
            print(f"{prefix} — file not found, skipping")
            errors += 1
            continue

        try:
            with Image.open(photo.filepath) as img:
                corrected, was_rotated = auto_rotate(img)
                if not was_rotated:
                    skipped += 1
                    continue
                if corrected.mode not in ("RGB", "L"):
                    corrected = corrected.convert("RGB")
                corrected.save(photo.filepath, quality=95)

            # Update hash to match corrected file
            photo.file_hash = md5(photo.filepath)
            db.session.commit()

            # Invalidate cached thumbnail
            thumb_path = os.path.join(THUMBNAIL_DIR, f"{photo.id}.jpg")
            if os.path.exists(thumb_path):
                os.remove(thumb_path)

            rotated += 1
            print(f"{prefix} — rotated")

        except Exception as e:
            db.session.rollback()
            print(f"{prefix} — error: {e}")
            errors += 1

    elapsed = time.monotonic() - start
    print(f"\n{'=' * 45}")
    print(f"ROTATION SUMMARY")
    print(f"{'=' * 45}")
    print(f"  Rotated:             {rotated}")
    print(f"  Already correct:     {skipped}")
    print(f"  Errors:              {errors}")
    print(f"  Time taken:          {elapsed:.1f}s")
    print(f"{'=' * 45}")


if __name__ == "__main__":
    with app.app_context():
        main()
