import { useState, useEffect, useRef, useCallback } from 'react';
import './PhotoNavigator.css';
import { API_BASE } from '../config';
import { faceColor } from '../utils/faceColours';

export default function PhotoNavigator({ photos, pagination, onPageChange, onSelectPhoto, showFaces }) {
  const { total, page, per_page } = pagination;
  const [localIndex, setLocalIndex] = useState(0);
  const targetLocalRef = useRef(0);

  const [faces, setFaces] = useState([]);
  const [imgRect, setImgRect] = useState(null);

  const wrapRef = useRef(null);
  const imgRef  = useRef(null);

  // When photos array changes (new page loaded), apply the pending local index
  useEffect(() => {
    setLocalIndex(Math.min(targetLocalRef.current, Math.max(0, photos.length - 1)));
  }, [photos]);

  if (photos.length === 0) {
    return <div className="navigator-empty">No photos match the selected filters</div>;
  }

  const photo = photos[localIndex];
  const globalIndex = (page - 1) * per_page + localIndex; // 0-based

  // ── Face data ──────────────────────────────────────────────────────────
  // Clear stale face data whenever the displayed photo changes
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    setImgRect(null);
    setFaces([]);
  }, [photo.id]);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!showFaces) return;
    fetch(`${API_BASE}/api/photos/${photo.id}/faces`)
      .then(r => r.json())
      .then(setFaces)
      .catch(() => setFaces([]));
  }, [photo.id, showFaces]);

  // Compute where the img element sits inside the wrap (accounts for flex
  // centering and padding) so we can position bboxes over the right pixels.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const updateImgRect = useCallback(() => {
    const img  = imgRef.current;
    const wrap = wrapRef.current;
    if (!img || !wrap || !img.naturalWidth) return;
    const wr = wrap.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    setImgRect({
      left: ir.left - wr.left,
      top:  ir.top  - wr.top,
      width: ir.width,
      height: ir.height,
      naturalWidth:  img.naturalWidth,
      naturalHeight: img.naturalHeight,
    });
  }, []);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(updateImgRect);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [updateImgRect]);

  // ── Navigation ─────────────────────────────────────────────────────────
  function navigateTo(targetGlobal) {
    const clamped = Math.max(0, Math.min(total - 1, targetGlobal));
    const targetPage  = Math.floor(clamped / per_page) + 1;
    const targetLocal = clamped % per_page;
    if (targetPage === page) {
      setLocalIndex(targetLocal);
    } else {
      targetLocalRef.current = targetLocal;
      onPageChange(targetPage);
    }
  }

  function NavBtn({ step, label }) {
    const target   = globalIndex + step;
    const disabled = target < 0 || target >= total;
    return (
      <button className="nav-btn" disabled={disabled} onClick={() => navigateTo(target)}>
        {label}
      </button>
    );
  }

  // ── Face box rendering ─────────────────────────────────────────────────
  function renderFaceBoxes() {
    if (!showFaces || !imgRect || !imgRect.naturalWidth || faces.length === 0) return null;
    const sx = imgRect.width  / imgRect.naturalWidth;
    const sy = imgRect.height / imgRect.naturalHeight;
    return faces.map(face => {
      const color = faceColor(face.cluster_id);
      return (
        <div
          key={face.id}
          className="face-box"
          style={{
            left:   imgRect.left + face.bbox.left  * sx,
            top:    imgRect.top  + face.bbox.top   * sy,
            width:  (face.bbox.right  - face.bbox.left) * sx,
            height: (face.bbox.bottom - face.bbox.top)  * sy,
            borderColor: color,
          }}
        >
          <span className="face-label" style={{ backgroundColor: color }}>
            {face.person_name || '?'}
          </span>
        </div>
      );
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="photo-navigator">
      <div
        className="navigator-photo-wrap"
        ref={wrapRef}
        onClick={() => onSelectPhoto(photo)}
      >
        <img
          key={photo.id}
          ref={imgRef}
          src={`${API_BASE}/api/photos/full/${photo.id}`}
          alt={photo.filename}
          className="navigator-photo"
          onLoad={updateImgRect}
        />
        {renderFaceBoxes()}
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
