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
    # valid types: source, location, date, people, event, general
    tag_type = db.Column(db.String(50), nullable=False)

    __table_args__ = (
        db.UniqueConstraint("name", "tag_type", name="uq_tag_name_type"),
        db.CheckConstraint(
            "tag_type IN ('source', 'location', 'date', 'people', 'event', 'general')",
            name="ck_tag_tag_type",
        ),
    )

    photos = db.relationship("Photo", secondary="photo_tags", back_populates="tags")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "tag_type": self.tag_type,
        }


class PhotoTag(db.Model):
    __tablename__ = "photo_tags"

    photo_id = db.Column(db.Integer, db.ForeignKey("photos.id"), primary_key=True)
    tag_id = db.Column(db.Integer, db.ForeignKey("tags.id"), primary_key=True)
