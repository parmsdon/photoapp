import os

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from PIL import Image

import config
from models import db, Photo, Tag, PhotoTag

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = config.SQLALCHEMY_DATABASE_URI
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

CORS(app)
db.init_app(app)

THUMBNAIL_DIR = os.path.join(config.BASE_DIR, "thumbnails")

with app.app_context():
    db.create_all()


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
    query = query.order_by(Photo.date_taken.desc().nullslast(), Photo.created_at.desc())

    total = query.count()
    photos = query.offset((page - 1) * per_page).limit(per_page).all()

    return jsonify({
        "photos": [p.to_dict() for p in photos],
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
        photo = Photo.query.get_or_404(photo_id)
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
    photo = Photo.query.get_or_404(photo_id)
    return send_from_directory(os.path.dirname(photo.filepath), os.path.basename(photo.filepath))


@app.route("/api/photos/<int:photo_id>", methods=["GET"])
def get_photo(photo_id):
    photo = Photo.query.get_or_404(photo_id)
    return jsonify(photo.to_dict())


@app.route("/api/photos/<int:photo_id>", methods=["DELETE"])
def delete_photo(photo_id):
    photo = Photo.query.get_or_404(photo_id)
    db.session.delete(photo)
    db.session.commit()
    return jsonify({"deleted": photo_id})


@app.route("/api/photos/<int:photo_id>/file")
def serve_photo(photo_id):
    photo = Photo.query.get_or_404(photo_id)
    return send_from_directory(os.path.dirname(photo.filepath), os.path.basename(photo.filepath))


# --- Tags ---

@app.route("/api/tags", methods=["GET"])
def list_tags():
    tags = Tag.query.order_by(Tag.tag_type, Tag.name).all()
    return jsonify([t.to_dict() for t in tags])


@app.route("/api/tags/categories")
def tag_categories():
    from sqlalchemy import func

    rows = (
        db.session.query(Tag, func.count(PhotoTag.photo_id).label("count"))
        .outerjoin(PhotoTag, PhotoTag.tag_id == Tag.id)
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
    photo = Photo.query.get_or_404(photo_id)
    data = request.get_json(force=True)
    tag_id = data.get("tag_id")
    if not tag_id:
        return jsonify({"error": "tag_id is required"}), 400
    tag = Tag.query.get_or_404(tag_id)
    if tag not in photo.tags:
        photo.tags.append(tag)
        db.session.commit()
    return jsonify(photo.to_dict())


@app.route("/api/photos/<int:photo_id>/tags/<int:tag_id>", methods=["DELETE"])
def remove_tag_from_photo(photo_id, tag_id):
    photo = Photo.query.get_or_404(photo_id)
    tag = Tag.query.get_or_404(tag_id)
    if tag in photo.tags:
        photo.tags.remove(tag)
        db.session.commit()
    return jsonify(photo.to_dict())


if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000, debug=True)
