"""
Database migrations. Safe to run at any time — each migration checks
whether the change is already applied before doing anything.
"""

from flask import Flask
from sqlalchemy import text

import config
from models import db

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = config.SQLALCHEMY_DATABASE_URI
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)


def column_exists(conn, table, column):
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return any(row[1] == column for row in rows)


def add_processed_faces(conn):
    if column_exists(conn, "photos", "processed_faces"):
        print("  processed_faces: already exists — skipped")
        return
    conn.execute(text(
        "ALTER TABLE photos ADD COLUMN processed_faces BOOLEAN NOT NULL DEFAULT 0"
    ))
    conn.commit()
    print("  processed_faces: added to photos table")


def add_protected_to_tags(conn):
    if column_exists(conn, "tags", "protected"):
        print("  protected: already exists — skipped")
        return
    conn.execute(text(
        "ALTER TABLE tags ADD COLUMN protected BOOLEAN NOT NULL DEFAULT 0"
    ))
    conn.commit()
    print("  protected: added to tags table")


def add_manual_to_faces(conn):
    if column_exists(conn, "faces", "manual"):
        print("  manual: already exists — skipped")
        return
    conn.execute(text(
        "ALTER TABLE faces ADD COLUMN manual BOOLEAN NOT NULL DEFAULT 0"
    ))
    conn.commit()
    print("  manual: added to faces table")


def main():
    print("Running database migrations...\n")
    with db.engine.connect() as conn:
        add_processed_faces(conn)
        add_protected_to_tags(conn)
        add_manual_to_faces(conn)
    print("\nDone.")


if __name__ == "__main__":
    with app.app_context():
        main()
