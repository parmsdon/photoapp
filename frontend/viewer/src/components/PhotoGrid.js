import './PhotoGrid.css';
import { API_BASE } from '../config';

export default function PhotoGrid({ photos, onSelectPhoto }) {
  if (photos.length === 0) {
    return <div className="photo-grid-empty">No photos match the selected filters</div>;
  }

  return (
    <div className="photo-grid">
      {photos.map(photo => (
        <div key={photo.id} className="grid-thumb" onClick={() => onSelectPhoto(photo)}>
          <img
            src={`${API_BASE}/api/photos/thumbnail/${photo.id}`}
            alt={photo.filename}
            loading="lazy"
          />
          <div className="grid-thumb-overlay">
            <span className="grid-thumb-name">{photo.filename}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
