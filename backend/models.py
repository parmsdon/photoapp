from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Photo(db.Model):
    __tablename__ = "photos"

    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    filepath = db.Column(db.String(1024), nullable=False, unique=True)
    file_hash = db.Column(db.String(64), nullable=True, index=True)
    date_taken = db.Column(db.DateTime, nullable=True)
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    processed_faces = db.Column(db.Boolean, default=False, nullable=False)

    tags = db.relationship("Tag", secondary="photo_tags", back_populates="photos")

    def to_dict(self):
        return {
            "id": self.id,
            "filename": self.filename,
            "filepath": self.filepath,
            "file_hash": self.file_hash,
            "date_taken": self.date_taken.isoformat() if self.date_taken else None,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "created_at": self.created_at.isoformat(),
            "tags": [t.to_dict() for t in self.tags],
        }


class Tag(db.Model):
    __tablename__ = "tags"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    # valid types: source, location, region, country, year, month, season, people, event, general
    tag_type = db.Column(db.String(50), nullable=False)
    protected = db.Column(db.Boolean, default=False, nullable=False)

    __table_args__ = (
        db.UniqueConstraint("name", "tag_type", name="uq_tag_name_type"),
    )

    photos = db.relationship("Photo", secondary="photo_tags", back_populates="tags")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "tag_type": self.tag_type,
            "protected": self.protected,
        }


class PhotoTag(db.Model):
    __tablename__ = "photo_tags"

    photo_id = db.Column(db.Integer, db.ForeignKey("photos.id"), primary_key=True)
    tag_id = db.Column(db.Integer, db.ForeignKey("tags.id"), primary_key=True)


class PersonCluster(db.Model):
    __tablename__ = "person_clusters"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    face_count = db.Column(db.Integer, nullable=False, default=0)
    sample_photo_id = db.Column(db.Integer, db.ForeignKey("photos.id"), nullable=True)

    sample_photo = db.relationship("Photo", foreign_keys=[sample_photo_id])
    faces = db.relationship("Face", back_populates="cluster", foreign_keys="Face.cluster_id")

    def default_name(self):
        return f"Person_{self.id}"

    def rename(self, new_name, db_session):
        """
        Rename this cluster and update the corresponding 'people' tag on all
        associated photos from the old name to new_name.
        Does not commit — caller is responsible.
        """
        old_name = self.name
        self.name = new_name

        old_tag = Tag.query.filter_by(name=old_name, tag_type="people").first()
        if old_tag:
            # Check whether a tag with the new name already exists
            existing = Tag.query.filter_by(name=new_name, tag_type="people").first()
            if existing:
                for photo in list(old_tag.photos):
                    if existing not in photo.tags:
                        photo.tags.append(existing)
                db_session.delete(old_tag)
            else:
                old_tag.name = new_name

        for face in self.faces:
            face.person_name = new_name

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "face_count": self.face_count,
            "sample_photo_id": self.sample_photo_id,
        }


class Face(db.Model):
    __tablename__ = "faces"

    id = db.Column(db.Integer, primary_key=True)
    photo_id = db.Column(db.Integer, db.ForeignKey("photos.id"), nullable=False, index=True)
    # 128-float face encoding stored as a JSON array
    encoding = db.Column(db.JSON, nullable=False)
    cluster_id = db.Column(db.Integer, db.ForeignKey("person_clusters.id"), nullable=True, index=True)
    person_name = db.Column(db.String(255), nullable=True)
    bbox_top = db.Column(db.Integer, nullable=False)
    bbox_right = db.Column(db.Integer, nullable=False)
    bbox_bottom = db.Column(db.Integer, nullable=False)
    bbox_left = db.Column(db.Integer, nullable=False)
    manual = db.Column(db.Boolean, default=False, nullable=False)

    photo = db.relationship("Photo", foreign_keys=[photo_id])
    cluster = db.relationship("PersonCluster", back_populates="faces", foreign_keys=[cluster_id])

    def to_dict(self):
        return {
            "id": self.id,
            "photo_id": self.photo_id,
            "cluster_id": self.cluster_id,
            "person_name": self.person_name,
            "manual": self.manual,
            "bbox": {
                "top": self.bbox_top,
                "right": self.bbox_right,
                "bottom": self.bbox_bottom,
                "left": self.bbox_left,
            },
        }
