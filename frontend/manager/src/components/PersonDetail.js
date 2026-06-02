import { useState, useEffect, useRef, useCallback } from 'react';
import './PersonDetail.css';
import { API_BASE } from '../config';

const API = `${API_BASE}/api`;

const CARD_W   = 180;
const CARD_H   = 220; // thumb 180 + info 40
const GAP      = 10;
const GRID_PAD = 12;
const HEADER_H = 44;
const PAGER_H  = 44;

function calcPageSize(w, h) {
  const gridH = h - HEADER_H - PAGER_H;
  const cols  = Math.max(1, Math.floor((w - GRID_PAD * 2 + GAP) / (CARD_W + GAP)));
  const rows  = Math.max(1, Math.floor((gridH - GRID_PAD * 2 + GAP) / (CARD_H + GAP)));
  return cols * rows;
}

// Scale face bboxes (original image space) to the object-fit:cover thumbnail display space
function computeScaledBoxes(faces, img) {
  if (!img || !img.naturalWidth || !faces.length) return [];
  const iw = faces[0].image_width;
  if (!iw) return [];
  const toThumb = img.naturalWidth / iw;
  const cw = img.clientWidth;
  const ch = img.clientHeight;
  const cs = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
  const ox = (cw - img.naturalWidth * cs) / 2;
  const oy = (ch - img.naturalHeight * cs) / 2;
  return faces.map(f => ({
    ...f,
    x: f.bbox_left   * toThumb * cs + ox,
    y: f.bbox_top    * toThumb * cs + oy,
    w: (f.bbox_right  - f.bbox_left) * toThumb * cs,
    h: (f.bbox_bottom - f.bbox_top)  * toThumb * cs,
  }));
}

// ── PhotoCard ──────────────────────────────────────────────────────────────

function PhotoCard({ item, onDisassociate }) {
  const imgRef  = useRef(null);
  const [boxes, setBoxes] = useState([]);

  const compute = useCallback(() => {
    setBoxes(computeScaledBoxes(item.faces, imgRef.current));
  }, [item.faces]);

  useEffect(() => { compute(); }, [compute]);

  return (
    <div className="pd-card">
      <div className="pd-thumb">
        <img
          ref={imgRef}
          src={`${API_BASE}/api/photos/thumbnail/${item.photo_id}`}
          alt={item.filename}
          loading="lazy"
          onLoad={compute}
        />
        {boxes.map(box => (
          <div key={box.face_id} className="pd-face-box"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
            <button
              className="pd-disassociate-btn"
              onClick={e => { e.stopPropagation(); onDisassociate(box); }}
            >✕ Remove</button>
          </div>
        ))}
      </div>
      <div className="pd-info">
        <span className="pd-filename" title={item.filename}>{item.filename}</span>
      </div>
    </div>
  );
}

// ── PersonDetail ───────────────────────────────────────────────────────────

export default function PersonDetail({ cluster, onBack, afterTagOperation }) {
  const [photos, setPhotos]         = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1, per_page: 50 });
  const [pageSize, setPageSize]     = useState(20);
  const [pendingDisassociate, setPendingDisassociate] = useState(null); // {face_id, ...}

  const containerRef = useRef(null);
  const lastSizeRef  = useRef(0);
  const debounceRef  = useRef(null);

  const fetchPhotos = useCallback((page, perPage) => {
    fetch(`${API}/people/clusters/${cluster.id}/photos?page=${page}&per_page=${perPage}`)
      .then(r => r.json())
      .then(data => {
        setPhotos(data.photos);
        setPagination({ total: data.total, page: data.page, pages: data.pages, per_page: data.per_page });
      })
      .catch(console.error);
  }, [cluster.id]);

  useEffect(() => { fetchPhotos(1, pageSize); }, [fetchPhotos, pageSize]);

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      const newSize = calcPageSize(width, height);
      if (newSize === lastSizeRef.current) return;
      lastSizeRef.current = newSize;
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setPageSize(newSize), 150);
    });
    observer.observe(el);
    return () => { observer.disconnect(); clearTimeout(debounceRef.current); };
  }, []);

  async function confirmDisassociate() {
    await fetch(`${API}/people/faces/disassociate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ face_id: pendingDisassociate.face_id }),
    });
    setPendingDisassociate(null);
    fetchPhotos(pagination.page, pageSize);
    afterTagOperation();
  }

  const { page, pages } = pagination;

  return (
    <div className="person-detail" ref={containerRef}>
      <div className="pd-header">
        <nav className="pd-breadcrumb">
          <button className="pd-breadcrumb-link" onClick={onBack}>People</button>
          <span className="pd-breadcrumb-sep">›</span>
          <span className="pd-breadcrumb-current">{cluster.name}</span>
        </nav>
        <span className="pd-count">{pagination.total} photo{pagination.total !== 1 ? 's' : ''}</span>
      </div>

      {photos.length === 0 ? (
        <div className="pd-empty">No photos found for this person.</div>
      ) : (
        <div className="pd-grid">
          {photos.map(item => (
            <PhotoCard key={item.photo_id} item={item} onDisassociate={setPendingDisassociate} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="pd-pagination">
          <button className="pp-btn" disabled={page <= 1}
            onClick={() => fetchPhotos(page - 1, pageSize)}>← Prev</button>
          <span className="pp-info">Page {page} of {pages}</span>
          <button className="pp-btn" disabled={page >= pages}
            onClick={() => fetchPhotos(page + 1, pageSize)}>Next →</button>
        </div>
      )}

      {pendingDisassociate && (
        <div className="pd-overlay" onClick={() => setPendingDisassociate(null)}>
          <div className="pd-confirm" onClick={e => e.stopPropagation()}>
            <p className="pd-confirm-title">Remove face?</p>
            <p className="pd-confirm-msg">
              Remove this face from <strong>{cluster.name}</strong>?
              The face will become unidentified. This cannot be undone.
            </p>
            <div className="pd-confirm-actions">
              <button className="dc-btn dc-cancel" onClick={() => setPendingDisassociate(null)}>Cancel</button>
              <button className="dc-btn dc-delete-person" onClick={confirmDisassociate}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
