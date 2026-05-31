"""
One-time migration script: splits coarse tag types into granular types.

  'date'     tags → 'year', 'month', or 'season'  (classified by name)
  'location' tags → 'location', 'region', or 'country'  (classified via reverse_geocoder)

Safe to run once. Running again is a no-op because no 'date' or old-style
'location' tags will remain after the first run.

IMPORTANT: This script drops and recreates the tags table to remove the old
SQLite CHECK constraint before updating tag_type values. Run it before
starting the app after updating models.py.
"""

import calendar
import re
import sys

from flask import Flask
from sqlalchemy import text

import config
from models import db, Photo, Tag

MONTH_NAMES = {m.lower() for m in calendar.month_name if m}
SEASON_NAMES = {"spring", "summer", "autumn", "winter"}

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = config.SQLALCHEMY_DATABASE_URI
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)


# ---------------------------------------------------------------------------
# Step 1: drop the old CHECK constraint via SQLite table rebuild
# ---------------------------------------------------------------------------

def drop_old_check_constraint():
    """
    Recreate the tags table without the old CHECK constraint so that UPDATE
    statements using the new tag_type values are accepted by SQLite.
    Idempotent — safe to call even if no constraint exists.
    """
    db.session.execute(text("PRAGMA foreign_keys=OFF"))
    db.session.execute(text("""
        CREATE TABLE IF NOT EXISTS _tags_migration (
            id       INTEGER NOT NULL PRIMARY KEY,
            name     VARCHAR(255) NOT NULL,
            tag_type VARCHAR(50)  NOT NULL,
            CONSTRAINT uq_tag_name_type UNIQUE (name, tag_type)
        )
    """))
    db.session.execute(text("INSERT OR IGNORE INTO _tags_migration SELECT id, name, tag_type FROM tags"))
    db.session.execute(text("DROP TABLE tags"))
    db.session.execute(text("ALTER TABLE _tags_migration RENAME TO tags"))
    db.session.commit()
    db.session.execute(text("PRAGMA foreign_keys=ON"))
    db.session.commit()


# ---------------------------------------------------------------------------
# Step 2: classify and update date tags
# ---------------------------------------------------------------------------

def classify_date(name):
    if re.fullmatch(r"\d{4}", name):
        return "year"
    if name.lower() in MONTH_NAMES:
        return "month"
    if name.lower() in SEASON_NAMES:
        return "season"
    return None


def migrate_date_tags():
    tags = Tag.query.filter_by(tag_type="date").all()
    if not tags:
        return 0, 0

    updated = skipped = 0
    for tag in tags:
        new_type = classify_date(tag.name)
        if not new_type:
            print(f"  [SKIP] date tag '{tag.name}' — could not classify")
            skipped += 1
            continue
        _retype(tag, new_type)
        updated += 1

    db.session.commit()
    return updated, skipped


# ---------------------------------------------------------------------------
# Step 3: classify and update location tags
# ---------------------------------------------------------------------------

def build_location_sets():
    """
    Reverse geocode all unique GPS coords from photos and return three sets:
    towns, regions, countries.  Falls back to empty sets if no GPS data
    or reverse_geocoder is unavailable.
    """
    try:
        import reverse_geocoder as rg
    except ImportError:
        print("  [WARN] reverse_geocoder not installed — location sub-type classification skipped")
        return set(), set(), set()

    coords = (
        db.session.query(Photo.latitude, Photo.longitude)
        .filter(Photo.latitude.isnot(None))
        .distinct()
        .all()
    )
    if not coords:
        return set(), set(), set()

    results = rg.search(coords, verbose=False)
    towns = set()
    regions = set()
    countries = set()
    for r in results:
        if r.get("name"):
            towns.add(r["name"])
        if r.get("admin1"):
            regions.add(r["admin1"])
        if r.get("cc"):
            countries.add(r["cc"])

    # Resolve ambiguities: town > region > country
    regions -= towns
    countries -= towns | regions
    return towns, regions, countries


def classify_location(name, towns, regions, countries):
    if name in towns:
        return "location"
    if name in regions:
        return "region"
    if name in countries:
        return "country"
    # Fallback heuristic: 2-letter uppercase = country code
    if re.fullmatch(r"[A-Z]{2}", name):
        return "country"
    return "location"  # default: assume town/city


def migrate_location_tags():
    tags = Tag.query.filter_by(tag_type="location").all()
    if not tags:
        return 0, 0

    print("  Reverse geocoding GPS data to classify location tags...")
    towns, regions, countries = build_location_sets()

    updated = unchanged = 0
    for tag in tags:
        new_type = classify_location(tag.name, towns, regions, countries)
        if new_type == "location":
            unchanged += 1
            continue  # already the correct type
        _retype(tag, new_type)
        updated += 1

    db.session.commit()
    return updated, unchanged


# ---------------------------------------------------------------------------
# Shared helper
# ---------------------------------------------------------------------------

def _retype(tag, new_type):
    """
    Change tag.tag_type to new_type.  If a tag with (name, new_type) already
    exists, merge by reassigning photo associations then deleting the old tag.
    """
    conflict = Tag.query.filter_by(name=tag.name, tag_type=new_type).first()
    if conflict:
        for photo in list(tag.photos):
            if conflict not in photo.tags:
                photo.tags.append(conflict)
        db.session.delete(tag)
    else:
        tag.tag_type = new_type


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("Step 1: removing old CHECK constraint from tags table...")
    drop_old_check_constraint()
    print("  Done.\n")

    print("Step 2: migrating date tags (date → year / month / season)...")
    date_updated, date_skipped = migrate_date_tags()
    print(f"  Updated: {date_updated}  |  Skipped: {date_skipped}\n")

    print("Step 3: migrating location tags (location → location / region / country)...")
    loc_updated, loc_unchanged = migrate_location_tags()
    print(f"  Reclassified: {loc_updated}  |  Already 'location': {loc_unchanged}\n")

    total = date_updated + loc_updated
    print(f"Migration complete — {total} tag(s) updated.")


if __name__ == "__main__":
    with app.app_context():
        main()
