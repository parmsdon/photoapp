"""
Detect faces in all unprocessed photos and store encodings in the database.
Run repeatedly — only processes photos where processed_faces=False.
"""

import argparse
import os
import time

import face_recognition
from flask import Flask

import config
from models import db, Face, Photo

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = config.SQLALCHEMY_DATABASE_URI
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)

BATCH_SIZE = 50


def detect_faces(photo):
    """
    Run face detection on one photo.
    Returns (faces_added: int, had_error: bool).
    Always sets photo.processed_faces = True.
    """
    try:
        image = face_recognition.load_image_file(photo.filepath)
        locations = face_recognition.face_locations(image, model="hog")
        encodings = face_recognition.face_encodings(image, locations)

        for (top, right, bottom, left), encoding in zip(locations, encodings):
            db.session.add(Face(
                photo_id=photo.id,
                encoding=encoding.tolist(),
                bbox_top=top,
                bbox_right=right,
                bbox_bottom=bottom,
                bbox_left=left,
            ))

        photo.processed_faces = True
        return len(locations), False

    except Exception as exc:
        print(f"  Error: {photo.filename} — {exc}")
        photo.processed_faces = True  # don't retry broken files
        return 0, True


def main(limit=None):
    start = time.monotonic()

    query = Photo.query.filter_by(processed_faces=False)
    if limit:
        query = query.limit(limit)
    photos = query.all()
    total = len(photos)
    print(f"Found {total} unprocessed photo(s){f' (limit {limit})' if limit else ''}.\n")

    if not total:
        print("Nothing to do.")
        return

    total_faces = no_faces = errors = 0

    for i, photo in enumerate(photos, 1):
        if not os.path.exists(photo.filepath):
            print(f"[{i}/{total}] {photo.filename} — file not found")
            photo.processed_faces = True
            no_faces += 1
            errors += 1
        else:
            found, had_error = detect_faces(photo)
            total_faces += found
            if found == 0:
                no_faces += 1
            if had_error:
                errors += 1

        if i % BATCH_SIZE == 0:
            db.session.commit()

        if i % 100 == 0 or i == total:
            elapsed = time.monotonic() - start
            rate = i / elapsed if elapsed > 0 else 0
            print(f"[{i}/{total}] {total_faces} faces found so far — {rate:.1f} photos/s")

    db.session.commit()
    elapsed = time.monotonic() - start
    photos_with_faces = total - no_faces
    avg = total_faces / photos_with_faces if photos_with_faces > 0 else 0

    print(f"\n{'=' * 48}")
    print(f"FACE DETECTION SUMMARY")
    print(f"{'=' * 48}")
    print(f"  Photos processed:     {total}")
    print(f"  Total faces found:    {total_faces}")
    print(f"  Photos with no faces: {no_faces}")
    print(f"  Avg faces per photo:  {avg:.1f}")
    print(f"  Errors:               {errors}")
    print(f"  Time taken:           {elapsed:.1f}s")
    print(f"{'=' * 48}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Detect faces in unprocessed photos.")
    parser.add_argument("--limit", type=int, default=None, metavar="N",
                        help="Process at most N photos (useful for testing)")
    args = parser.parse_args()
    with app.app_context():
        main(args.limit)
