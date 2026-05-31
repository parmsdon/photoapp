import { useState, useEffect, useRef, useCallback } from 'react';
import './PhotoGrid.css';
import { API_BASE } from '../config';
import { faceColor } from '../utils/faceColours';

// Must match the values in PhotoGrid.css
const GRID_PADDING = 3;
const GAP          = 3;
const MIN_COL      = 180;

function calcPageSize(width, height) {
  const w = width  - GRID_PADDING * 2;
  const h = height - GRID_PADDING * 2;
  const numCols  = Math.max(1, Math.floor((w + GAP) / (MIN_COL + GAP)));
  const cellSize = (w - (numCols - 1) * GAP) / numCols;
  const numRows  = Math.max(1, Math.floor((h + GAP) / (cellSize + GAP)));
  return numCols * numRows;
}

// ── GridThumb ──────────────────────────────────────────────────────────────
// Defined outside PhotoGrid so it isn't re-created on every parent render.

function GridThumb({ photo, onSelectPhoto, faceCache, showFaces }) {
  const [faces, setFaces] = useState(() => faceCache.current[photo.id] ?? null);
  const [scaledBoxes, setScaledBoxes] = useState([]);
  const imgRef = useRef(null);

  // Fetch face data (skip if photo has no detected faces)
  useEffect(() => {
    if (photo.has_faces === false) return;
    if (faceCache.current[photo.id] !== undefined) {
      setFaces(faceCache.current[photo.id]);
      return;
    }
    fetch(`${API_BASE}/api/photos/${photo.id}/faces`)
      .then(r => r.json())
      .then(data => {
        faceCache.current[photo.id] = data;
        setFaces(data);
      })
      .catch(() => { faceCache.current[photo.id] = []; });
  }, [photo.id, photo.has_faces, faceCache]);

  // Scale bboxes from original image space → thumbnail space → cell space
  const computeBoxes = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !faces?.length) { setScaledBoxes([]); return; }
    const { image_width } = faces[0];
    if (!image_width) return;

    // original → thumbnail
    const toThumb = img.naturalWidth / image_width;
    // thumbnail → cell (object-fit: cover in a square cell)
    const cw = img.clientWidth;
    const ch = img.clientHeight;
    const cs = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const ox = (cw - img.naturalWidth  * cs) / 2;
    const oy = (ch - img.naturalHeight * cs) / 2;

    setScaledBoxes(faces.map(face => ({
      id:         face.id,
      cluster_id: face.cluster_id,
      style: {
        left:   face.bbox.left   * toThumb * cs + ox,
        top:    face.bbox.top    * toThumb * cs + oy,
        width:  (face.bbox.right  - face.bbox.left)  * toThumb * cs,
        height: (face.bbox.bottom - face.bbox.top) * toThumb * cs,
      },
    })));
  }, [faces]);

  useEffect(() => { computeBoxes(); }, [computeBoxes]);

  return (
    <div className="grid-thumb" onClick={() => onSelectPhoto(photo)}>
      <img
        ref={imgRef}
        src={`${API_BASE}/api/photos/thumbnail/${photo.id}`}
        alt={photo.filename}
        loading="lazy"
        onLoad={computeBoxes}
      />
      {showFaces && scaledBoxes.map(box => (
        <div
          key={box.id}
          className="thumb-face-box"
          style={{ ...box.style, borderColor: faceColor(box.cluster_id) }}
        />
      ))}
      <div className="grid-thumb-overlay">
        <span className="grid-thumb-name">{photo.filename}</span>
      </div>
    </div>
  );
}

// ── PhotoGrid ──────────────────────────────────────────────────────────────

export default function PhotoGrid({ photos, onSelectPhoto, onPageSizeChange, showFaces }) {
  const gridRef     = useRef(null);
  const lastSizeRef = useRef(0);
  const debounceRef = useRef(null);
  const faceCache   = useRef({});  // { [photoId]: Face[] } — persists across re-renders

  useEffect(() => {
    const el = gridRef.current;
    if (!el || !onPageSizeChange) return;

    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      const newSize = calcPageSize(width, height);
      if (newSize === lastSizeRef.current) return;
      lastSizeRef.current = newSize;
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onPageSizeChange(newSize), 150);
    });

    observer.observe(el);
    return () => { observer.disconnect(); clearTimeout(debounceRef.current); };
  }, [onPageSizeChange]);

  return (
    <div className="photo-grid" ref={gridRef}>
      {photos.length === 0
        ? <div className="photo-grid-empty">No photos match the selected filters</div>
        : photos.map(photo => (
            <GridThumb
              key={photo.id}
              photo={photo}
              onSelectPhoto={onSelectPhoto}
              faceCache={faceCache}
              showFaces={showFaces}
            />
          ))
      }
    </div>
  );
}
