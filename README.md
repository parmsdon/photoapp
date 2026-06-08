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

### Frontend (development)

There are two React frontends. Each needs its own `.env.local` with the
address of the Flask server on your network.

```bash
# viewer (http://localhost:3000)
cd frontend/viewer
cp .env.local.example .env.local
# edit .env.local — set REACT_APP_API_BASE=http://<your-server-ip>:5000
npm install
npm start

# manager (http://localhost:3001)
cd frontend/manager
cp .env.local.example .env.local
# edit .env.local — set REACT_APP_API_BASE=http://<your-server-ip>:5000
npm install
npm start
```

`REACT_APP_API_BASE` tells the dev server where Flask is running. The dev
server also proxies `/api/` calls automatically (via the `proxy` field in
`package.json`), but setting the env variable ensures the correct host is
used when the browser accesses the API directly.

In production `REACT_APP_API_BASE` is not set, so `API_BASE` defaults to
`''` and all API calls are relative — handled by the Nginx `proxy_pass`
to Gunicorn.

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
