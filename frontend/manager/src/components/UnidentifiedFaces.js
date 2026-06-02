import { useState, useEffect, useRef, useCallback } from 'react';
import './UnidentifiedFaces.css';
import { API_BASE } from '../config';

const API = `${API_BASE}/api`;

const CARD_W   = 150;
const CARD_H   = 195; // 150 crop + 45 action
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

// ── FaceCropCard ───────────────────────────────────────────────────────────

function FaceCropCard({ face, clusters, onAssigned }) {
  const [showPicker, setShowPicker] = useState(false);
  const [assigning, setAssigning]   = useState(false);

  async function assign(clusterId) {
    setAssigning(true);
    await fetch(`${API}/people/faces/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ face_id: face.face_id, cluster_id: clusterId }),
    });
    setAssigning(false);
    setShowPicker(false);
    onAssigned();
  }

  return (
    <div className="uf-card">
      <div className="uf-crop">
        <img
          src={`${API_BASE}/api/people/faces/${face.face_id}/crop`}
          alt={`Face ${face.face_id}`}
          loading="lazy"
        />
      </div>
      <div className="uf-actions">
        {showPicker ? (
          <div className="uf-picker">
            <div className="uf-picker-scroll">
              {clusters.map(c => (
                <button key={c.id} className="uf-picker-item"
                  disabled={assigning}
                  onClick={() => assign(c.id)}>
                  <span className="uf-picker-name">{c.name}</span>
                  <span className="uf-picker-count">{c.face_count}</span>
                </button>
              ))}
            </div>
            <button className="uf-cancel-btn" onClick={() => setShowPicker(false)}>Cancel</button>
          </div>
        ) : (
          <button className="uf-assign-btn" onClick={() => setShowPicker(true)}>
            Assign →
          </button>
        )}
      </div>
    </div>
  );
}

// ── UnidentifiedFaces ──────────────────────────────────────────────────────

export default function UnidentifiedFaces({ onBack, afterTagOperation }) {
  const [faces, setFaces]           = useState([]);
  const [clusters, setClusters]     = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1, per_page: 50 });
  const [pageSize, setPageSize]     = useState(30);

  const containerRef = useRef(null);
  const lastSizeRef  = useRef(0);
  const debounceRef  = useRef(null);

  const fetchFaces = useCallback((page, perPage) => {
    fetch(`${API}/people/unidentified/faces?page=${page}&per_page=${perPage}`)
      .then(r => r.json())
      .then(data => {
        setFaces(data.faces);
        setPagination({ total: data.total, page: data.page, pages: data.pages, per_page: data.per_page });
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetchFaces(1, pageSize);
    fetch(`${API}/people/clusters`)
      .then(r => r.json())
      .then(setClusters)
      .catch(console.error);
  }, [fetchFaces, pageSize]);

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

  function handleAssigned() {
    fetchFaces(pagination.page, pageSize);
    afterTagOperation();
  }

  const { page, pages, total } = pagination;

  return (
    <div className="uf-container" ref={containerRef}>
      <div className="uf-header">
        <button className="pd-back-btn" onClick={onBack}>← Back</button>
        <span className="pd-title">Unidentified Faces</span>
        <span className="pd-count">{total} face{total !== 1 ? 's' : ''}</span>
      </div>

      {faces.length === 0 ? (
        <div className="pd-empty">No unidentified faces — everyone has been identified!</div>
      ) : (
        <div className="uf-grid">
          {faces.map(face => (
            <FaceCropCard
              key={face.face_id}
              face={face}
              clusters={clusters}
              onAssigned={handleAssigned}
            />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="pd-pagination">
          <button className="pp-btn" disabled={page <= 1}
            onClick={() => fetchFaces(page - 1, pageSize)}>← Prev</button>
          <span className="pp-info">Page {page} of {pages}</span>
          <button className="pp-btn" disabled={page >= pages}
            onClick={() => fetchFaces(page + 1, pageSize)}>Next →</button>
        </div>
      )}
    </div>
  );
}
