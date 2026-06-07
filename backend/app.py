import json
import os

from flask import Flask, abort, jsonify, request, send_from_directory
from sqlalchemy import select as sa_select
from flask_cors import CORS
from PIL import Image

import config
from models import db, Face, FaceSuggestion, PersonCluster, Photo, Tag, PhotoTag

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = config.SQLALCHEMY_DATABASE_URI
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

CORS(app)
db.init_app(app)

THUMBNAIL_DIR  = os.path.join(config.BASE_DIR, "thumbnails")
FACE_CROPS_DIR = os.path.join(config.BASE_DIR, "face_crops")

with app.app_context():
    db.create_all()
    # Ensure the protected archive tag exists and cache its ID
    _arc = Tag.query.filter_by(name='archive', tag_type='general').first()
    if not _arc:
        _arc = Tag(name='archive', tag_type='general', protected=True)
        db.session.add(_arc)
        db.session.commit()
    elif not _arc.protected:
        _arc.protected = True
        db.session.commit()
    app.config['ARCHIVE_TAG_ID'] = _arc.id


# --- Photos ---

@app.route("/api/photos", methods=["GET"])
def list_photos():
    tag_filter = request.args.get("tag")
    query = Photo.query
    if tag_filter:
        query = query.join(Photo.tags).filter(Tag.name == tag_filter)
    photos = query.order_by(Photo.date_taken.desc().nullslast(), Photo.created_at.desc()).all()
    return jsonify([p.to_dict() for p in photos])


@app.route("/api/photos/filter")
def filter_photos():
    tags_raw = request.args.get("tags", "")
    tag_ids = [int(t) for t in tags_raw.split(",") if t.strip().isdigit()]
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(max(1, int(request.args.get("per_page", 50))), 100)

    query = Photo.query
    for tag_id in tag_ids:
        query = query.filter(Photo.tags.any(Tag.id == tag_id))

    # Exclude archived photos unless the archive tag is explicitly in the filter
    archive_id = app.config.get('ARCHIVE_TAG_ID')
    if archive_id and archive_id not in tag_ids:
        query = query.filter(~Photo.tags.any(Tag.id == archive_id))

    query = query.order_by(Photo.date_taken.desc().nullslast(), Photo.created_at.desc())

    total = query.count()
    photos = query.offset((page - 1) * per_page).limit(per_page).all()

    # Batch check which photos have face records (avoids N+1 queries)
    photo_ids = [p.id for p in photos]
    face_photo_ids = set()
    if photo_ids:
        rows = db.session.query(Face.photo_id).filter(
            Face.photo_id.in_(photo_ids)
        ).distinct().all()
        face_photo_ids = {r[0] for r in rows}

    return jsonify({
        "photos": [{**p.to_dict(), "has_faces": p.id in face_photo_ids} for p in photos],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    })


@app.route("/api/photos/thumbnail/<int:photo_id>")
def photo_thumbnail(photo_id):
    os.makedirs(THUMBNAIL_DIR, exist_ok=True)
    thumb_filename = f"{photo_id}.jpg"
    thumb_path = os.path.join(THUMBNAIL_DIR, thumb_filename)

    if not os.path.exists(thumb_path):
        photo = db.session.get(Photo, photo_id) or abort(404)
        try:
            img = Image.open(photo.filepath)
            img.thumbnail((300, 300))
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            img.save(thumb_path, "JPEG", quality=85)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return send_from_directory(THUMBNAIL_DIR, thumb_filename)


@app.route("/api/photos/full/<int:photo_id>")
def photo_full(photo_id):
    photo = db.session.get(Photo, photo_id) or abort(404)
    return send_from_directory(os.path.dirname(photo.filepath), os.path.basename(photo.filepath))


@app.route("/api/photos/<int:photo_id>", methods=["GET"])
def get_photo(photo_id):
    photo = db.session.get(Photo, photo_id) or abort(404)
    return jsonify(photo.to_dict())


@app.route("/api/photos/<int:photo_id>", methods=["DELETE"])
def delete_photo(photo_id):
    photo = db.session.get(Photo, photo_id) or abort(404)
    db.session.delete(photo)
    db.session.commit()
    return jsonify({"deleted": photo_id})


@app.route("/api/photos/<int:photo_id>/faces")
def get_photo_faces(photo_id):
    photo = db.session.get(Photo, photo_id) or abort(404)
    faces = Face.query.filter_by(photo_id=photo_id).all()
    if not faces:
        return jsonify([])
    # Include original image dimensions so the frontend can scale bboxes correctly
    try:
        with Image.open(photo.filepath) as img:
            image_width, image_height = img.size
    except Exception:
        image_width = image_height = None
    result = [{**f.to_dict(), "image_width": image_width, "image_height": image_height}
              for f in faces]
    return jsonify(result)


@app.route("/api/photos/<int:photo_id>/file")
def serve_photo(photo_id):
    photo = db.session.get(Photo, photo_id) or abort(404)
    return send_from_directory(os.path.dirname(photo.filepath), os.path.basename(photo.filepath))


# --- Tags ---

@app.route("/api/tags", methods=["GET"])
def list_tags():
    tags = Tag.query.order_by(Tag.tag_type, Tag.name).all()
    return jsonify([t.to_dict() for t in tags])


@app.route("/api/tags/available")
def available_tags():
    from sqlalchemy import func

    tags_raw = request.args.get("tags", "")
    tag_ids = [int(t) for t in tags_raw.split(",") if t.strip().isdigit()]
    archive_id = app.config.get('ARCHIVE_TAG_ID')

    if not tag_ids:
        # No active filters — counts across non-archived photos, archive tag excluded
        q = (
            db.session.query(Tag, func.count(PhotoTag.photo_id).label("count"))
            .join(PhotoTag, PhotoTag.tag_id == Tag.id)
            .group_by(Tag.id)
            .order_by(Tag.tag_type, Tag.name)
        )
        if archive_id:
            archived_sq = sa_select(PhotoTag.photo_id).where(PhotoTag.tag_id == archive_id)
            q = q.filter(Tag.id != archive_id).filter(PhotoTag.photo_id.notin_(archived_sq))
        rows = q.all()
    else:
        # Find photos matching ALL selected tags, excluding archived unless archive is selected
        photo_query = Photo.query
        for tag_id in tag_ids:
            photo_query = photo_query.filter(Photo.tags.any(Tag.id == tag_id))
        if archive_id and archive_id not in tag_ids:
            photo_query = photo_query.filter(~Photo.tags.any(Tag.id == archive_id))
        filtered_ids = [p.id for p in photo_query.with_entities(Photo.id).all()]

        if not filtered_ids:
            return jsonify({})

        # Archive tag is always excluded from results; selected tags also excluded
        excluded_ids = list(tag_ids) + ([archive_id] if archive_id else [])
        rows = (
            db.session.query(Tag, func.count(PhotoTag.photo_id).label("count"))
            .join(PhotoTag, PhotoTag.tag_id == Tag.id)
            .filter(PhotoTag.photo_id.in_(filtered_ids))
            .filter(Tag.id.notin_(excluded_ids))
            .group_by(Tag.id)
            .order_by(Tag.tag_type, Tag.name)
            .all()
        )

    result = {}
    for tag, count in rows:
        result.setdefault(tag.tag_type, []).append({
            "id": tag.id,
            "name": tag.name,
            "count": count,
        })

    return jsonify(result)


@app.route("/api/tags/categories")
def tag_categories():
    from sqlalchemy import func

    archive_id = app.config.get('ARCHIVE_TAG_ID')
    q = (
        db.session.query(Tag, func.count(PhotoTag.photo_id).label("count"))
        .join(PhotoTag, PhotoTag.tag_id == Tag.id)
        .group_by(Tag.id)
        .order_by(Tag.tag_type, Tag.name)
    )
    if archive_id:
        archived_sq = sa_select(PhotoTag.photo_id).where(PhotoTag.tag_id == archive_id)
        q = q.filter(Tag.id != archive_id).filter(PhotoTag.photo_id.notin_(archived_sq))
    rows = q.all()

    result = {}
    for tag, count in rows:
        result.setdefault(tag.tag_type, []).append({
            "id": tag.id,
            "name": tag.name,
            "count": count,
        })

    return jsonify(result)


@app.route("/api/tags/all")
def all_tags():
    """All tags grouped by category, archive tag excluded, no photo-visibility filtering.
    Counts include archived photos so tags like 'Junk' remain visible even when
    all their associated photos are archived."""
    from sqlalchemy import func

    archive_id = app.config.get('ARCHIVE_TAG_ID')
    q = (
        db.session.query(Tag, func.count(PhotoTag.photo_id).label("count"))
        .outerjoin(PhotoTag, PhotoTag.tag_id == Tag.id)
        .group_by(Tag.id)
        .order_by(Tag.tag_type, Tag.name)
    )
    if archive_id:
        q = q.filter(Tag.id != archive_id)
    rows = q.all()

    result = {}
    for tag, count in rows:
        result.setdefault(tag.tag_type, []).append({
            "id": tag.id,
            "name": tag.name,
            "count": count,
        })

    return jsonify(result)


@app.route("/api/tags", methods=["POST"])
def create_tag():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    tag_type = data.get("tag_type", "general").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    tag = Tag.query.filter_by(name=name, tag_type=tag_type).first()
    if not tag:
        tag = Tag(name=name, tag_type=tag_type)
        db.session.add(tag)
        db.session.commit()
    return jsonify(tag.to_dict()), 201


# --- Photo-Tag association ---

@app.route("/api/photos/<int:photo_id>/tags", methods=["POST"])
def add_tag_to_photo(photo_id):
    photo = db.session.get(Photo, photo_id) or abort(404)
    data = request.get_json(force=True)
    tag_id = data.get("tag_id")
    if not tag_id:
        return jsonify({"error": "tag_id is required"}), 400
    tag = db.session.get(Tag, tag_id) or abort(404)
    if tag not in photo.tags:
        photo.tags.append(tag)
        db.session.commit()
    return jsonify(photo.to_dict())


@app.route("/api/photos/<int:photo_id>/tags/<int:tag_id>", methods=["DELETE"])
def remove_tag_from_photo(photo_id, tag_id):
    photo = db.session.get(Photo, photo_id) or abort(404)
    tag = db.session.get(Tag, tag_id) or abort(404)
    if tag in photo.tags:
        photo.tags.remove(tag)
        db.session.commit()
    return jsonify(photo.to_dict())


# --- Manager: bulk tag operations ---

RECENT_TAGS_FILE = os.path.join(config.BASE_DIR, "recent_tags.json")
MAX_RECENT = 10


def _load_recent():
    try:
        with open(RECENT_TAGS_FILE) as f:
            return json.load(f)
    except Exception:
        return []


def _save_recent(ids):
    with open(RECENT_TAGS_FILE, "w") as f:
        json.dump(ids[:MAX_RECENT], f)


@app.route("/api/tags/<int:tag_id>", methods=["DELETE"])
def delete_tag(tag_id):
    tag = db.session.get(Tag, tag_id) or abort(404)
    if tag.protected:
        return jsonify({"error": "tag is protected and cannot be deleted"}), 403
    PhotoTag.query.filter_by(tag_id=tag_id).delete()
    db.session.delete(tag)
    db.session.commit()
    return jsonify({"deleted": tag_id})


@app.route("/api/tags/archive-id")
def get_archive_tag_id():
    archive_id = app.config.get('ARCHIVE_TAG_ID')
    if not archive_id:
        return jsonify({"error": "archive tag not found"}), 404
    return jsonify({"id": archive_id})


@app.route("/api/tags/recent", methods=["GET"])
def get_recent_tags():
    return jsonify({"tag_ids": _load_recent()})


@app.route("/api/tags/recent", methods=["POST"])
def record_recent_tag():
    tag_id = request.get_json(force=True).get("tag_id")
    if not tag_id:
        return jsonify({"error": "tag_id required"}), 400
    recent = [t for t in _load_recent() if t != tag_id]
    recent.insert(0, tag_id)
    _save_recent(recent)
    return jsonify({"tag_ids": recent[:MAX_RECENT]})


@app.route("/api/tags/create", methods=["POST"])
def create_tag_named():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    # tag_type accepts any non-empty string — custom categories are supported
    tag_type = data.get("tag_type", "general").strip().lower()
    if not name:
        return jsonify({"error": "name required"}), 400
    if not tag_type:
        return jsonify({"error": "tag_type required"}), 400
    tag = Tag.query.filter_by(name=name, tag_type=tag_type).first()
    if tag:
        return jsonify(tag.to_dict()), 200
    tag = Tag(name=name, tag_type=tag_type)
    db.session.add(tag)
    db.session.commit()
    return jsonify(tag.to_dict()), 201


@app.route("/api/photos/assign-tag", methods=["POST"])
def assign_tag_bulk():
    data = request.get_json(force=True)
    photo_ids = data.get("photo_ids", [])
    tag_id = data.get("tag_id")
    if not photo_ids or not tag_id:
        return jsonify({"error": "photo_ids and tag_id required"}), 400
    tag = db.session.get(Tag, tag_id) or abort(404)
    photos = Photo.query.filter(Photo.id.in_(photo_ids)).all()
    for photo in photos:
        if tag not in photo.tags:
            photo.tags.append(tag)
    db.session.commit()
    return jsonify({"updated": len(photos)})


@app.route("/api/photos/remove-tag", methods=["POST"])
def remove_tag_bulk():
    data = request.get_json(force=True)
    photo_ids = data.get("photo_ids", [])
    tag_id = data.get("tag_id")
    if not photo_ids or not tag_id:
        return jsonify({"error": "photo_ids and tag_id required"}), 400
    tag = db.session.get(Tag, tag_id) or abort(404)
    photos = Photo.query.filter(Photo.id.in_(photo_ids)).all()
    for photo in photos:
        if tag in photo.tags:
            photo.tags.remove(tag)
    db.session.commit()
    return jsonify({"updated": len(photos)})


# --- People management ---

@app.route("/api/people/clusters")
def get_people_clusters():
    from sqlalchemy import func
    clusters = PersonCluster.query.all()

    # Count distinct photos per cluster (matches tag panel photo counts)
    face_counts = dict(
        db.session.query(Face.cluster_id, func.count(Face.photo_id.distinct()))
        .group_by(Face.cluster_id)
        .all()
    )

    result = [
        {
            "id": c.id,
            "name": c.name,
            "face_count": face_counts.get(c.id, 0),
            "sample_photo_id": c.sample_photo_id,
            "thumbnail_url": f"/api/photos/thumbnail/{c.sample_photo_id}" if c.sample_photo_id else None,
        }
        for c in clusters
    ]
    result.sort(key=lambda x: x["face_count"], reverse=True)
    return jsonify(result)


def _make_face_crop(cluster_id, face, crop_path):
    """Crop and save a 300×300 JPEG centred on face. Raises on error."""
    photo = db.session.get(Photo, face.photo_id) or abort(404)
    img = Image.open(photo.filepath)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    iw, ih = img.size

    cx = (face.bbox_left + face.bbox_right)  / 2
    cy = (face.bbox_top  + face.bbox_bottom) / 2
    fw = face.bbox_right  - face.bbox_left
    fh = face.bbox_bottom - face.bbox_top

    print(
        f"[face-crop] cluster={cluster_id} face={face.id} "
        f"photo={face.photo_id} img={iw}x{ih} "
        f"bbox=(L{face.bbox_left},T{face.bbox_top},"
        f"R{face.bbox_right},B{face.bbox_bottom}) fw={fw} fh={fh}"
    )

    half   = max(fw, fh)  # face + 50% padding each side
    left   = max(0,  int(cx - half))
    top    = max(0,  int(cy - half))
    right  = min(iw, int(cx + half))
    bottom = min(ih, int(cy + half))

    cropped = img.crop((left, top, right, bottom))
    cropped = cropped.resize((300, 300), Image.LANCZOS)
    cropped.save(crop_path, "JPEG", quality=85)


@app.route("/api/people/clusters/<int:cluster_id>/face-crop")
def cluster_face_crop(cluster_id):
    import random as _rng
    os.makedirs(FACE_CROPS_DIR, exist_ok=True)

    # ?photo_id=X requests a crop for a specific photo (for "New Sample" cycling)
    photo_id = request.args.get("photo_id", type=int)
    crop_filename = f"{cluster_id}_{photo_id}.jpg" if photo_id else f"{cluster_id}.jpg"
    crop_path = os.path.join(FACE_CROPS_DIR, crop_filename)

    if not os.path.exists(crop_path):
        cluster = db.session.get(PersonCluster, cluster_id) or abort(404)

        if photo_id:
            face = Face.query.filter_by(cluster_id=cluster_id, photo_id=photo_id).first()
            if not face:
                return jsonify({"error": "no face for this cluster in that photo"}), 404
        else:
            face = Face.query.filter_by(cluster_id=cluster_id,
                                        photo_id=cluster.sample_photo_id).first()
            if not face:
                face = Face.query.filter_by(cluster_id=cluster_id).first()
            if not face:
                return jsonify({"error": "no faces found for cluster"}), 404

        try:
            _make_face_crop(cluster_id, face, crop_path)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return send_from_directory(FACE_CROPS_DIR, crop_filename)


@app.route("/api/people/clusters/<int:cluster_id>/next-sample")
def next_face_sample(cluster_id):
    """Return a random photo_id for this cluster, excluding the current one."""
    import random as _rng
    db.session.get(PersonCluster, cluster_id) or abort(404)
    exclude_id = request.args.get("exclude", type=int)

    q = db.session.query(Face.photo_id.distinct()).filter(Face.cluster_id == cluster_id)
    if exclude_id:
        q = q.filter(Face.photo_id != exclude_id)
    photo_ids = [row[0] for row in q.all()]

    if not photo_ids:
        return jsonify({"error": "no other photos available"}), 404

    return jsonify({"photo_id": _rng.choice(photo_ids)})


@app.route("/api/people/clusters/<int:cluster_id>", methods=["DELETE"])
def delete_person_cluster(cluster_id):
    cluster = db.session.get(PersonCluster, cluster_id) or abort(404)

    # Remove the people tag and all its photo associations
    people_tag = Tag.query.filter_by(name=cluster.name, tag_type="people").first()
    if people_tag:
        people_tag.photos.clear()
        db.session.flush()
        db.session.delete(people_tag)

    # Unassign all faces from this cluster
    Face.query.filter_by(cluster_id=cluster_id).update(
        {"cluster_id": None, "person_name": None},
        synchronize_session="fetch",
    )

    db.session.delete(cluster)
    db.session.commit()
    return jsonify({"deleted": cluster_id})


@app.route("/api/people/clusters/<int:cluster_id>/photos")
def get_cluster_photos(cluster_id):
    db.session.get(PersonCluster, cluster_id) or abort(404)
    page     = max(1, request.args.get("page",     1,  type=int))
    per_page = min(max(1, request.args.get("per_page", 50, type=int)), 100)

    photo_ids = [r[0] for r in
        db.session.query(Face.photo_id.distinct())
        .filter(Face.cluster_id == cluster_id).all()]
    total    = len(photo_ids)
    page_ids = photo_ids[(page - 1) * per_page : page * per_page]

    results = []
    for pid in page_ids:
        photo = db.session.get(Photo, pid)
        if not photo:
            continue
        try:
            with Image.open(photo.filepath) as img:
                iw, ih = img.size
        except Exception:
            iw = ih = None
        faces = Face.query.filter_by(cluster_id=cluster_id, photo_id=pid).all()
        results.append({
            "photo_id": pid,
            "filename": photo.filename,
            "faces": [{
                "face_id":      f.id,
                "bbox_top":     f.bbox_top,
                "bbox_right":   f.bbox_right,
                "bbox_bottom":  f.bbox_bottom,
                "bbox_left":    f.bbox_left,
                "image_width":  iw,
                "image_height": ih,
            } for f in faces],
        })

    return jsonify({"photos": results, "total": total, "page": page,
                    "per_page": per_page,
                    "pages": max(1, (total + per_page - 1) // per_page)})


@app.route("/api/people/faces/<int:face_id>/crop")
def individual_face_crop(face_id):
    os.makedirs(FACE_CROPS_DIR, exist_ok=True)
    crop_filename = f"face_{face_id}.jpg"
    crop_path = os.path.join(FACE_CROPS_DIR, crop_filename)
    if not os.path.exists(crop_path):
        face = db.session.get(Face, face_id) or abort(404)
        try:
            _make_face_crop(face.cluster_id, face, crop_path)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    return send_from_directory(FACE_CROPS_DIR, crop_filename)


@app.route("/api/people/unidentified/count")
def unidentified_face_count():
    return jsonify({"count": Face.query.filter_by(cluster_id=None).count()})


@app.route("/api/people/unidentified/faces")
def get_unidentified_faces():
    page     = max(1, request.args.get("page",     1,  type=int))
    per_page = min(max(1, request.args.get("per_page", 50, type=int)), 100)
    total = Face.query.filter_by(cluster_id=None).count()
    faces = (Face.query.filter_by(cluster_id=None)
             .order_by(Face.photo_id, Face.id)
             .offset((page - 1) * per_page).limit(per_page).all())
    return jsonify({
        "faces": [{"face_id": f.id, "photo_id": f.photo_id,
                   "bbox_top": f.bbox_top, "bbox_right": f.bbox_right,
                   "bbox_bottom": f.bbox_bottom, "bbox_left": f.bbox_left,
                   "crop_url": f"/api/people/faces/{f.id}/crop"} for f in faces],
        "total": total, "page": page, "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    })


@app.route("/api/people/faces/disassociate", methods=["POST"])
def disassociate_face():
    face_id = request.get_json(force=True).get("face_id")
    face = db.session.get(Face, face_id) or abort(404)
    if face.cluster_id is None:
        return jsonify({"error": "face is already unidentified"}), 400

    cluster_id  = face.cluster_id
    photo_id    = face.photo_id
    face.cluster_id  = None
    face.person_name = None
    db.session.flush()

    # Remove people tag from photo if no other faces from this cluster remain
    remaining = Face.query.filter_by(cluster_id=cluster_id, photo_id=photo_id).count()
    if remaining == 0:
        cluster = db.session.get(PersonCluster, cluster_id)
        photo   = db.session.get(Photo, photo_id)
        if cluster and photo:
            tag = Tag.query.filter_by(name=cluster.name, tag_type="people").first()
            if tag and tag in photo.tags:
                photo.tags.remove(tag)

    db.session.commit()
    return jsonify({"disassociated": face_id})


@app.route("/api/people/faces/assign", methods=["POST"])
def assign_face():
    data       = request.get_json(force=True)
    face_id    = data.get("face_id")
    cluster_id = data.get("cluster_id")
    face    = db.session.get(Face, face_id) or abort(404)
    cluster = db.session.get(PersonCluster, cluster_id) or abort(404)
    face.cluster_id  = cluster_id
    face.person_name = cluster.name
    cluster.face_count += 1
    # Ensure the people tag exists; create if missing
    tag = Tag.query.filter_by(name=cluster.name, tag_type="people").first()
    if not tag:
        tag = Tag(name=cluster.name, tag_type="people")
        db.session.add(tag)
        db.session.flush()
    photo = db.session.get(Photo, face.photo_id)
    if photo and tag not in photo.tags:
        photo.tags.append(tag)
    # Set sample photo for newly created clusters (no sample yet)
    if cluster.sample_photo_id is None:
        cluster.sample_photo_id = face.photo_id
        # Remove any stale cached crop so it regenerates from the correct photo
        for crop_name in (f"{cluster_id}.jpg", f"{cluster_id}_face.jpg"):
            crop_path = os.path.join(FACE_CROPS_DIR, crop_name)
            if os.path.exists(crop_path):
                os.remove(crop_path)
    db.session.commit()
    return jsonify({"assigned": face_id, "cluster_id": cluster_id})


@app.route("/api/people/rename", methods=["POST"])
def rename_person():
    data = request.get_json(force=True)
    cluster_id = data.get("cluster_id")
    new_name = (data.get("new_name") or "").strip()
    if not cluster_id or not new_name:
        return jsonify({"error": "cluster_id and new_name required"}), 400
    cluster = db.session.get(PersonCluster, cluster_id) or abort(404)
    cluster.rename(new_name, db.session)
    db.session.commit()
    return jsonify(cluster.to_dict())


@app.route("/api/people/merge", methods=["POST"])
def merge_people():
    data = request.get_json(force=True)
    source_id = data.get("source_cluster_id")
    target_id = data.get("target_cluster_id")
    if not source_id or not target_id or source_id == target_id:
        return jsonify({"error": "source_cluster_id and target_cluster_id are required and must differ"}), 400

    source = db.session.get(PersonCluster, source_id) or abort(404)
    target = db.session.get(PersonCluster, target_id) or abort(404)

    # Reassign all faces to target cluster
    Face.query.filter_by(cluster_id=source_id).update(
        {"cluster_id": target_id, "person_name": target.name},
        synchronize_session="fetch",
    )

    # Reassign people tags on affected photos
    source_tag = Tag.query.filter_by(name=source.name, tag_type="people").first()
    if source_tag:
        target_tag = Tag.query.filter_by(name=target.name, tag_type="people").first()
        if not target_tag:
            source_tag.name = target.name  # rename in place
        else:
            for photo in list(source_tag.photos):
                if target_tag not in photo.tags:
                    photo.tags.append(target_tag)
            db.session.flush()
            source_tag.photos.clear()
            db.session.flush()
            db.session.delete(source_tag)

    # Recount and delete source cluster
    target.face_count = Face.query.filter_by(cluster_id=target_id).count()
    db.session.delete(source)
    db.session.commit()

    return jsonify({"merged": source_id, "into": target_id})


# --- Face Editor ---

@app.route("/api/face-editor/photos")
def face_editor_photos():
    from sqlalchemy import exists as sql_exists

    filter_type = request.args.get("filter", "all")
    person_id   = request.args.get("person_id", type=int)
    page        = max(1, request.args.get("page", 1, type=int))
    per_page    = min(max(1, request.args.get("per_page", 1, type=int)), 100)

    # Base query
    query = Photo.query

    # 'faces' and narrower filters all require at least one face record
    if filter_type in ("faces", "unidentified", "person"):
        query = query.filter(
            sql_exists().where(Face.photo_id == Photo.id)
        )

    if filter_type == "unidentified":
        query = query.filter(
            sql_exists().where(
                db.and_(Face.photo_id == Photo.id, Face.cluster_id.is_(None))
            )
        )
    elif filter_type == "person" and person_id:
        query = query.filter(
            sql_exists().where(
                db.and_(Face.photo_id == Photo.id, Face.cluster_id == person_id)
            )
        )

    # Exclude archived photos
    archive_id = app.config.get("ARCHIVE_TAG_ID")
    if archive_id:
        query = query.filter(~Photo.tags.any(Tag.id == archive_id))

    query = query.order_by(Photo.date_taken.desc().nullslast(), Photo.created_at.desc())
    total = query.count()

    def photo_dict(photo):
        faces = Face.query.filter_by(photo_id=photo.id).all()
        try:
            with Image.open(photo.filepath) as img:
                iw, ih = img.size
        except Exception:
            iw = ih = None
        return {
            "id": photo.id,
            "filename": photo.filename,
            "date_taken": photo.date_taken.isoformat() if photo.date_taken else None,
            "image_width": iw,
            "image_height": ih,
            "faces": [{
                "face_id":    f.id,
                "cluster_id": f.cluster_id,
                "person_name": f.person_name,
                "bbox_top":   f.bbox_top,
                "bbox_right": f.bbox_right,
                "bbox_bottom": f.bbox_bottom,
                "bbox_left":  f.bbox_left,
                "manual":     f.manual,
            } for f in faces],
        }

    if per_page == 1:
        # Single mode — existing behaviour
        photo = query.offset(page - 1).first()
        if not photo:
            return jsonify({"photo": None, "total": total, "page": page, "pages": total})
        return jsonify({"photo": photo_dict(photo), "total": total, "page": page, "pages": total})

    # Grid mode — return multiple photos per page
    pages = max(1, (total + per_page - 1) // per_page)
    photos = query.offset((page - 1) * per_page).limit(per_page).all()
    return jsonify({
        "photos":   [photo_dict(p) for p in photos],
        "total":    total, "page": page, "pages": pages, "per_page": per_page,
    })


@app.route("/api/people/faces/delete", methods=["POST"])
def delete_face():
    face_id = request.get_json(force=True).get("face_id")
    face = db.session.get(Face, face_id) or abort(404)
    cluster_id = face.cluster_id
    photo_id   = face.photo_id
    db.session.delete(face)
    db.session.flush()
    if cluster_id:
        remaining = Face.query.filter_by(cluster_id=cluster_id, photo_id=photo_id).count()
        if remaining == 0:
            cluster = db.session.get(PersonCluster, cluster_id)
            photo   = db.session.get(Photo, photo_id)
            if cluster and photo:
                tag = Tag.query.filter_by(name=cluster.name, tag_type="people").first()
                if tag and tag in photo.tags:
                    photo.tags.remove(tag)
    db.session.commit()
    return jsonify({"deleted": face_id})


@app.route("/api/people/faces/manual", methods=["POST"])
def create_manual_face():
    data       = request.get_json(force=True)
    photo_id   = data.get("photo_id")
    x          = data.get("x")
    y          = data.get("y")
    radius     = data.get("radius", 50)
    cluster_id = data.get("cluster_id")

    photo = db.session.get(Photo, photo_id) or abort(404)
    try:
        with Image.open(photo.filepath) as img:
            iw, ih = img.size
    except Exception:
        iw = ih = 10000

    left   = max(0,  int(x - radius))
    top    = max(0,  int(y - radius))
    right  = min(iw, int(x + radius))
    bottom = min(ih, int(y + radius))

    cluster = db.session.get(PersonCluster, cluster_id) if cluster_id else None
    face = Face(
        photo_id=photo_id,
        encoding=[],
        cluster_id=cluster_id,
        person_name=cluster.name if cluster else None,
        bbox_top=top, bbox_right=right, bbox_bottom=bottom, bbox_left=left,
        manual=True,
    )
    db.session.add(face)
    db.session.flush()
    if cluster:
        tag = Tag.query.filter_by(name=cluster.name, tag_type="people").first()
        if tag and tag not in photo.tags:
            photo.tags.append(tag)
    db.session.commit()
    return jsonify({"face_id": face.id, "bbox_top": top, "bbox_right": right,
                    "bbox_bottom": bottom, "bbox_left": left}), 201


@app.route("/api/people/clusters/create", methods=["POST"])
def create_empty_cluster():
    # Flush with a placeholder name to obtain the new primary key, then
    # set the canonical Person_NNNNN name from that ID.  This guarantees
    # uniqueness even after deletions (count-based naming would not).
    cluster = PersonCluster(name="__pending__", face_count=0, sample_photo_id=None)
    db.session.add(cluster)
    db.session.flush()
    cluster.name = f"Person_{cluster.id:05d}"
    # Create the corresponding people tag so assignment works immediately
    tag = Tag.query.filter_by(name=cluster.name, tag_type="people").first()
    if not tag:
        db.session.add(Tag(name=cluster.name, tag_type="people"))
    db.session.commit()
    return jsonify(cluster.to_dict()), 201


@app.route("/api/people/fix-tags")
def fix_person_tags():
    """One-time utility: create missing people tags and associate them with the correct photos."""
    clusters = PersonCluster.query.all()
    tags_created = 0
    photos_tagged = 0

    for cluster in clusters:
        # Get or create the people tag for this cluster
        tag = Tag.query.filter_by(name=cluster.name, tag_type="people").first()
        if not tag:
            tag = Tag(name=cluster.name, tag_type="people")
            db.session.add(tag)
            db.session.flush()
            tags_created += 1

        # Find all photos with faces from this cluster
        photo_ids = {f.photo_id for f in Face.query.filter_by(cluster_id=cluster.id).all()}
        for photo in Photo.query.filter(Photo.id.in_(photo_ids)).all():
            if tag not in photo.tags:
                photo.tags.append(tag)
                photos_tagged += 1

    db.session.commit()
    return jsonify({"tags_created": tags_created, "photos_tagged": photos_tagged})


@app.route("/api/people/fix-counts")
def fix_person_counts():
    """One-time utility: recalculate face_count and verify sample_photo_id for every cluster."""
    from sqlalchemy import func
    counts = dict(
        db.session.query(Face.cluster_id, func.count(Face.id))
        .filter(Face.cluster_id.isnot(None))
        .group_by(Face.cluster_id)
        .all()
    )
    # First face photo_id per cluster (for sample fallback)
    first_face = dict(
        db.session.query(Face.cluster_id, Face.photo_id)
        .filter(Face.cluster_id.isnot(None))
        .distinct(Face.cluster_id)
        .all()
    )
    clusters = PersonCluster.query.all()
    samples_fixed = 0
    for c in clusters:
        c.face_count = counts.get(c.id, 0)
        # Verify sample_photo_id has a face from this cluster
        if c.sample_photo_id is not None:
            valid = Face.query.filter_by(
                cluster_id=c.id, photo_id=c.sample_photo_id
            ).first() is not None
        else:
            valid = False
        if not valid:
            c.sample_photo_id = first_face.get(c.id)  # None if cluster has no faces
            samples_fixed += 1
    db.session.commit()
    return jsonify({
        "clusters_fixed": len(clusters),
        "samples_fixed": samples_fixed,
        "counts": {str(k): v for k, v in counts.items()},
    })


# --- Face suggestion review ---

@app.route("/api/people/suggestions/compute", methods=["POST"])
def compute_suggestions():
    import numpy as np

    data       = request.get_json(force=True)
    cluster_id = data.get("cluster_id")
    max_gap    = float(data.get("max_gap", 0.15))
    db.session.get(PersonCluster, cluster_id) or abort(404)

    # Clear existing unreviewed suggestions for this cluster
    FaceSuggestion.query.filter_by(current_cluster_id=cluster_id, reviewed=False).delete()
    db.session.flush()

    # Build centroid (mean encoding) for every cluster that has encodings
    all_faces = Face.query.filter(Face.cluster_id.isnot(None)).all()
    enc_by_cluster: dict[int, list] = {}
    for f in all_faces:
        if f.encoding:
            enc_by_cluster.setdefault(f.cluster_id, []).append(f.encoding)

    centroids = {cid: np.mean(encs, axis=0) for cid, encs in enc_by_cluster.items()}
    own_centroid = centroids.get(cluster_id)
    if own_centroid is None:
        db.session.commit()
        return jsonify({"count": 0})

    other_centroids = {cid: c for cid, c in centroids.items() if cid != cluster_id}
    if not other_centroids:
        db.session.commit()
        return jsonify({"count": 0})

    target_faces = Face.query.filter_by(cluster_id=cluster_id).all()
    count = 0
    for face in target_faces:
        if not face.encoding:
            continue
        enc = np.array(face.encoding)
        dist_own = float(np.linalg.norm(enc - own_centroid))

        # Find top 3 closest other cluster centroids, sorted by distance
        ranked = sorted(
            ((cid, float(np.linalg.norm(enc - cent))) for cid, cent in other_centroids.items()),
            key=lambda x: x[1]
        )[:3]

        for rank, (other_id, other_dist) in enumerate(ranked, 1):
            gap = other_dist - dist_own
            if gap >= max_gap:
                break  # sorted by distance, so later ones are farther — stop early
            db.session.add(FaceSuggestion(
                face_id=face.id,
                current_cluster_id=cluster_id,
                suggested_cluster_id=other_id,
                confidence_gap=gap,
                rank=rank,
                reviewed=False,
            ))
            count += 1

    db.session.commit()
    return jsonify({"count": count})


@app.route("/api/people/suggestions")
def get_suggestions():
    from collections import defaultdict

    cluster_id = request.args.get("cluster_id", type=int)
    max_gap    = request.args.get("max_gap", 0.15, type=float)
    if not cluster_id:
        return jsonify({"error": "cluster_id required"}), 400

    rows = (FaceSuggestion.query
            .filter_by(current_cluster_id=cluster_id, reviewed=False)
            .filter(FaceSuggestion.confidence_gap <= max_gap)
            .order_by(FaceSuggestion.face_id, FaceSuggestion.rank)
            .all())

    # Group by face_id — one entry per face with up to 3 alternatives
    grouped: dict = defaultdict(list)
    for s in rows:
        grouped[s.face_id].append(s)

    result = []
    for face_id, suggestions in grouped.items():
        face = db.session.get(Face, face_id)
        if not face:
            continue
        first = suggestions[0]
        photo = db.session.get(Photo, face.photo_id)
        result.append({
            "face_id":               face_id,
            "photo_id":              face.photo_id,
            "filename":              photo.filename if photo else None,
            "face_crop_url":         f"/api/people/faces/{face_id}/crop",
            "photo_thumbnail_url":   f"/api/photos/thumbnail/{face.photo_id}",
            "current_cluster_id":    first.current_cluster_id,
            "current_cluster_name":  first.current_cluster.name if first.current_cluster else None,
            "current_sample_crop_url": f"/api/people/clusters/{first.current_cluster_id}/face-crop",
            "alternatives": [
                {
                    "suggestion_id":  s.id,
                    "rank":           s.rank,
                    "cluster_id":     s.suggested_cluster_id,
                    "cluster_name":   s.suggested_cluster.name if s.suggested_cluster else None,
                    "sample_crop_url": f"/api/people/clusters/{s.suggested_cluster_id}/face-crop",
                    "confidence_gap": round(s.confidence_gap, 4),
                }
                for s in suggestions
            ],
        })
    return jsonify(result)


@app.route("/api/people/suggestions/accept", methods=["POST"])
def accept_suggestion():
    suggestion_id = request.get_json(force=True).get("suggestion_id")
    s = db.session.get(FaceSuggestion, suggestion_id) or abort(404)
    face = db.session.get(Face, s.face_id)
    if face:
        old_cid = face.cluster_id
        new_cid = s.suggested_cluster_id
        face.cluster_id  = new_cid
        new_cluster = db.session.get(PersonCluster, new_cid)
        face.person_name = new_cluster.name if new_cluster else None
        db.session.flush()
        photo = db.session.get(Photo, face.photo_id)
        if photo:
            if old_cid:
                remaining = Face.query.filter_by(cluster_id=old_cid, photo_id=face.photo_id).count()
                if remaining == 0:
                    old_cluster = db.session.get(PersonCluster, old_cid)
                    if old_cluster:
                        old_tag = Tag.query.filter_by(name=old_cluster.name, tag_type="people").first()
                        if old_tag and old_tag in photo.tags:
                            photo.tags.remove(old_tag)
            if new_cluster:
                new_tag = Tag.query.filter_by(name=new_cluster.name, tag_type="people").first()
                if new_tag and new_tag not in photo.tags:
                    photo.tags.append(new_tag)
    # Mark all suggestions for this face as reviewed (siblings no longer relevant)
    FaceSuggestion.query.filter_by(face_id=s.face_id, reviewed=False).update({"reviewed": True})
    db.session.commit()
    return jsonify({"accepted": suggestion_id})


@app.route("/api/people/suggestions/reject", methods=["POST"])
def reject_suggestion():
    suggestion_id = request.get_json(force=True).get("suggestion_id")
    s = db.session.get(FaceSuggestion, suggestion_id) or abort(404)
    s.reviewed = True
    db.session.commit()
    return jsonify({"rejected": suggestion_id})


if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000, debug=True)
