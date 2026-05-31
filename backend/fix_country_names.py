"""
One-time fix: replaces 2-letter ISO country codes in country tags with full
country names (e.g. "GB" → "United Kingdom").

Safe to run repeatedly — tags already using full names are left unchanged.
"""

import re

from flask import Flask

import config
from models import db, Tag
from tagger import COUNTRY_NAMES

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = config.SQLALCHEMY_DATABASE_URI
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)

CODE_PATTERN = re.compile(r"^[A-Z]{2}$")


def main():
    country_tags = Tag.query.filter_by(tag_type="country").all()
    total = len(country_tags)
    print(f"Found {total} country tag(s).\n")

    updated = skipped = unrecognised = 0

    for tag in country_tags:
        if not CODE_PATTERN.match(tag.name):
            skipped += 1
            continue  # already a full name

        full_name = COUNTRY_NAMES.get(tag.name)
        if not full_name:
            print(f"  [WARN] unrecognised code '{tag.name}' — skipped")
            unrecognised += 1
            continue

        # Check whether a tag with the full name already exists
        existing = Tag.query.filter_by(name=full_name, tag_type="country").first()
        if existing:
            # Merge: reassign all photo associations then delete the code tag
            for photo in list(tag.photos):
                if existing not in photo.tags:
                    photo.tags.append(existing)
            db.session.delete(tag)
            print(f"  Merged '{tag.name}' → '{full_name}' (existing tag)")
        else:
            print(f"  Renamed '{tag.name}' → '{full_name}'")
            tag.name = full_name

        updated += 1

    db.session.commit()

    print(f"\n{'=' * 40}")
    print(f"  Updated:      {updated}")
    print(f"  Already OK:   {skipped}")
    print(f"  Unrecognised: {unrecognised}")
    print(f"{'=' * 40}")


if __name__ == "__main__":
    with app.app_context():
        main()
