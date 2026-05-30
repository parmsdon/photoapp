"""
Shared tag generation logic used by importer.py and tag_enricher.py.
"""

import os

SEASONS = {
    12: "Winter", 1: "Winter", 2: "Winter",
    3: "Spring", 4: "Spring", 5: "Spring",
    6: "Summer", 7: "Summer", 8: "Summer",
    9: "Autumn", 10: "Autumn", 11: "Autumn",
}


def generate_location_tags(lat, lon):
    """Reverse geocode (lat, lon) and return (name, 'location') tuples for town, region, country."""
    if lat is None or lon is None:
        return []
    try:
        import reverse_geocoder as rg
        results = rg.search((lat, lon), verbose=False)
        if not results:
            return []
        r = results[0]
        tags = []
        if r.get("name"):
            tags.append((r["name"], "location"))
        if r.get("admin1"):
            tags.append((r["admin1"], "location"))
        if r.get("cc"):
            tags.append((r["cc"], "location"))
        return tags
    except Exception:
        return []


def generate_date_tags(date_taken):
    """Return (name, 'date') tuples for year, month name, and season."""
    if date_taken is None:
        return []
    return [
        (str(date_taken.year), "date"),
        (date_taken.strftime("%B"), "date"),
        (SEASONS[date_taken.month], "date"),
    ]


def generate_source_tag(filepath):
    """Return a (name, 'source') tuple using the file's immediate parent folder name."""
    return (os.path.basename(os.path.dirname(filepath)), "source")


def apply_tags_to_photo(photo, tags, db_session):
    """
    Associate (name, tag_type) pairs with a photo, creating Tag rows as needed.
    Skips pairs that are already present on the photo. Does not commit.
    Returns the number of tags newly added.
    """
    from models import Tag

    existing_ids = {t.id for t in photo.tags}
    added = 0
    for name, tag_type in tags:
        if not name:
            continue
        tag = Tag.query.filter_by(name=name, tag_type=tag_type).first()
        if not tag:
            tag = Tag(name=name, tag_type=tag_type)
            db_session.add(tag)
            db_session.flush()
        if tag.id not in existing_ids:
            photo.tags.append(tag)
            existing_ids.add(tag.id)
            added += 1
    return added
