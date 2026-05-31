import './PhotoStrip.css';
import { API_BASE } from '../config';

export default function PhotoStrip({ photos, onSelectPhoto }) {
  if (photos.length === 0) {
    return <div className="photo-strip-empty">No photos match the selected filters</div>;
  }

  return (
    <div className="photo-strip-wrapper">
      <div className="photo-strip">
        {photos.map(photo => (
          <div key={photo.id} className="strip-thumb" onClick={() => onSelectPhoto(photo)}>
            <img
              src={`${API_BASE}/api/photos/thumbnail/${photo.id}`}
              alt={photo.filename}
              loading="lazy"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
