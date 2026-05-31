"""
Applies location and date tags to all existing photos in the database.
Generates granular types: location, region, country, year, month, season.
Safe to run repeatedly — skips tags already present.
"""

import time

from flask import Flask

import config
import tagger
from models import db, Photo

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = config.SQLALCHEMY_DATABASE_URI
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)


def main():
    start = time.monotonic()
    photos = Photo.query.all()
    total = len(photos)
    print(f"Enriching {total} photo(s) with location/region/country and year/month/season tags.\n")

    updated = skipped = total_added = 0

    for i, photo in enumerate(photos, 1):
        new_tags = tagger.generate_date_tags(photo.date_taken)
        new_tags += tagger.generate_location_tags(photo.latitude, photo.longitude)

        if not new_tags:
            skipped += 1
            print(f"[{i}/{total}] {photo.filename} — skipped (no date or GPS data)")
            continue

        added = tagger.apply_tags_to_photo(photo, new_tags, db.session)
        db.session.commit()

        total_added += added
        updated += 1
        print(f"[{i}/{total}] {photo.filename} — {added} tag(s) added")

    elapsed = time.monotonic() - start
    print(f"\n{'=' * 50}")
    print(f"ENRICHMENT SUMMARY")
    print(f"{'=' * 50}")
    print(f"  Photos updated:   {updated}")
    print(f"  Photos skipped:   {skipped}")
    print(f"  Tags added:       {total_added}")
    print(f"  Time taken:       {elapsed:.1f}s")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    with app.app_context():
        main()
