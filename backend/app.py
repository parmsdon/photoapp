from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

import config
from models import db, Photo, Tag, PhotoTag

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = config.SQLALCHEMY_DATABASE_URI
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

CORS(app)
db.init_app(app)

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
    import os
    directory = os.path.dirname(photo.filepath)
    filename = os.path.basename(photo.filepath)
    return send_from_directory(directory, filename)


# --- Tags ---

@app.route("/api/tags", methods=["GET"])
def list_tags():
    tags = Tag.query.order_by(Tag.tag_type, Tag.name).all()
    return jsonify([t.to_dict() for t in tags])


@app.route("/api/tags", methods=["POST"])
def create_tag():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    tag_type = data.get("tag_type", "user").strip()
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
    app.run(debug=True, port=5000)
