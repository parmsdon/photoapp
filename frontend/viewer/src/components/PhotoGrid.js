import { useRef, useEffect, useCallback } from 'react';
import './PhotoGrid.css';
import { API_BASE } from '../config';

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

export default function PhotoGrid({ photos, onSelectPhoto, onPageSizeChange }) {
  const gridRef      = useRef(null);
  const lastSizeRef  = useRef(0);
  const debounceRef  = useRef(null);

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
          ))
      }
    </div>
  );
}
