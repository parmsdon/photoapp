import { useState, useEffect, useRef } from 'react';
import './PhotoNavigator.css';
import { API_BASE } from '../config';

export default function PhotoNavigator({ photos, pagination, onPageChange, onSelectPhoto }) {
  const { total, page, per_page } = pagination;
  const [localIndex, setLocalIndex] = useState(0);
  const targetLocalRef = useRef(0);

  // When photos array changes (new page loaded), apply the pending local index
  useEffect(() => {
    setLocalIndex(Math.min(targetLocalRef.current, Math.max(0, photos.length - 1)));
  }, [photos]);

  if (photos.length === 0) {
    return <div className="navigator-empty">No photos match the selected filters</div>;
  }

  const photo = photos[localIndex];
  const globalIndex = (page - 1) * per_page + localIndex; // 0-based

  function navigateTo(targetGlobal) {
    const clamped = Math.max(0, Math.min(total - 1, targetGlobal));
    const targetPage = Math.floor(clamped / per_page) + 1;
    const targetLocal = clamped % per_page;
    if (targetPage === page) {
      setLocalIndex(targetLocal);
    } else {
      targetLocalRef.current = targetLocal;
      onPageChange(targetPage);
    }
  }

  function NavBtn({ step, label }) {
    const target = globalIndex + step;
    const disabled = target < 0 || target >= total;
    return (
      <button className="nav-btn" disabled={disabled} onClick={() => navigateTo(target)}>
        {label}
      </button>
    );
  }

  return (
    <div className="photo-navigator">
      <div className="navigator-photo-wrap" onClick={() => onSelectPhoto(photo)}>
        <img
          key={photo.id}
          src={`${API_BASE}/api/photos/full/${photo.id}`}
          alt={photo.filename}
          className="navigator-photo"
        />
      </div>

      <div className="navigator-info">
        <span className="navigator-filename">{photo.filename}</span>
        {photo.date_taken && (
          <span className="navigator-date">
            {new Date(photo.date_taken).toLocaleDateString(undefined, { dateStyle: 'long' })}
          </span>
        )}
      </div>

      <div className="navigator-controls">
        <button className="nav-btn" disabled={globalIndex === 0} onClick={() => navigateTo(0)}>
          First
        </button>
        <NavBtn step={-100} label="−100" />
        <NavBtn step={-10}  label="−10"  />
        <NavBtn step={-1}   label="−1"   />
        <span className="nav-counter">{(globalIndex + 1).toLocaleString()} / {total.toLocaleString()}</span>
        <NavBtn step={+1}   label="+1"   />
        <NavBtn step={+10}  label="+10"  />
        <NavBtn step={+100} label="+100" />
        <button className="nav-btn" disabled={globalIndex === total - 1} onClick={() => navigateTo(total - 1)}>
          Last
        </button>
      </div>
    </div>
  );
}
