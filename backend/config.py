import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SOURCE_FOLDERS = [
    os.path.join(BASE_DIR, "source_photos"),
]

DESTINATION_FOLDER = os.path.join(BASE_DIR, "processed_photos")

DATABASE_PATH = os.path.join(BASE_DIR, "photoapp.db")
SQLALCHEMY_DATABASE_URI = f"sqlite:///{DATABASE_PATH}"
