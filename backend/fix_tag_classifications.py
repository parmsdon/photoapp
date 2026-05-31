"""
Fix misclassified location/region tags in the database.
Safe to run repeatedly — each operation checks current state before acting.
"""

from flask import Flask

import config
from models import db, Tag

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = config.SQLALCHEMY_DATABASE_URI
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)


def get_or_create_tag(name, tag_type):
    tag = Tag.query.filter_by(name=name, tag_type=tag_type).first()
    if not tag:
        tag = Tag(name=name, tag_type=tag_type)
        db.session.add(tag)
        db.session.flush()
    return tag


def move_tag(name, from_type, to_type, also_add=None):
    """
    For every photo carrying (name, from_type):
      - Add (name, to_type) if not already present.
      - Add each (name, type) in also_add if not already present.
      - Remove (name, from_type).
    Deletes the source tag row if it ends up with no photos.
    Returns a dict with photo count and extra tags applied.
    """
    source = Tag.query.filter_by(name=name, tag_type=from_type).first()
    if not source:
        return None

    photos = list(source.photos)
    if not photos:
        db.session.delete(source)
        db.session.flush()
        return {"photos": 0, "extra_applied": {}}

    dest = get_or_create_tag(name, to_type)

    extra_counts = {f"{n} ({t})": 0 for n, t in (also_add or [])}

    for photo in photos:
        if source in photo.tags:
            photo.tags.remove(source)
        if dest not in photo.tags:
            photo.tags.append(dest)
        for extra_name, extra_type in (also_add or []):
            extra_tag = get_or_create_tag(extra_name, extra_type)
            if extra_tag not in photo.tags:
                photo.tags.append(extra_tag)
                extra_counts[f"{extra_name} ({extra_type})"] += 1

    db.session.flush()
    if not source.photos:
        db.session.delete(source)
    db.session.flush()

    return {"photos": len(photos), "extra_applied": extra_counts}


def report(label, result):
    if result is None:
        print(f"  {label}: not found — skipped")
        return
    n = result["photos"]
    print(f"  {label}: {n} photo{'s' if n != 1 else ''} updated")
    for tag_label, count in result["extra_applied"].items():
        if count:
            print(f"    + '{tag_label}' added to {count} photo{'s' if count != 1 else ''}")


def main():
    print("Fixing tag classifications...\n")

    # 1. City-states misclassified as towns: location → country
    print("1. City-states: location → country")
    for name in ["Hong Kong", "Singapore"]:
        report(name, move_tag(name, "location", "country"))

    # 2. UK nations misclassified as regions: region → country, + United Kingdom
    print("\n2. UK nations: region → country (+ United Kingdom country tag)")
    for name in ["England", "Scotland", "Wales"]:
        report(name, move_tag(name, "region", "country",
                              also_add=[("United Kingdom", "country")]))

    # 3. Wanchai misclassified as region: region → location
    print("\n3. Wanchai: region → location")
    report("Wanchai", move_tag("Wanchai", "region", "location"))

    # 4. Luxembourg misclassified as location (it's both city and country)
    #    Add as country tag, remove location tag
    print("\n4. Luxembourg: location → country")
    report("Luxembourg", move_tag("Luxembourg", "location", "country"))

    db.session.commit()
    print("\nDone — all changes committed.")


if __name__ == "__main__":
    with app.app_context():
        main()
