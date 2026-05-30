# PhotoApp

A personal photo management application with a Flask REST API backend and React frontend.

## Features

- Browse and search photos by tag
- Tags are categorized by type: `source`, `metadata`, `face`, `user`
- Configurable source and destination folders (default: `backend/source_photos` → `backend/processed_photos`)
- EXIF metadata extraction (date taken, GPS coordinates)
- Face recognition tagging
- Many-to-many photo/tag relationships

## Project Structure

```
photoapp/
├── backend/
│   ├── app.py          # Flask app and REST API routes
│   ├── models.py       # SQLAlchemy models (Photo, Tag, PhotoTag)
│   ├── config.py       # Source folders, destination folder, DB path
│   └── requirements.txt
├── frontend/
│   ├── package.json
│   ├── public/
│   │   └── index.html
│   └── src/
│       ├── App.js      # Main React app
│       └── components/ # UI components
└── .gitignore
```

## Database Models

| Model    | Fields |
|----------|--------|
| Photo    | id, filename, filepath, file_hash, date_taken, latitude, longitude, created_at |
| Tag      | id, name, tag_type (source/metadata/face/user) |
| PhotoTag | photo_id, tag_id (join table) |

## Setup

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

The API will be available at `http://localhost:5000`.

### Frontend

```bash
cd frontend
npm install
npm start
```

The React app will be available at `http://localhost:3000` and proxies API calls to the Flask backend.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET    | /api/photos | List all photos (optional `?tag=` filter) |
| GET    | /api/photos/:id | Get a single photo |
| DELETE | /api/photos/:id | Delete a photo record |
| GET    | /api/photos/:id/file | Serve the photo file |
| GET    | /api/tags | List all tags |
| POST   | /api/tags | Create a tag |
| POST   | /api/photos/:id/tags | Add a tag to a photo |
| DELETE | /api/photos/:id/tags/:tag_id | Remove a tag from a photo |
