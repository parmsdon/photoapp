import { useState, useEffect, useRef, useCallback } from 'react';
import './FaceEditor.css';
import { API_BASE } from '../config';

const API = `${API_BASE}/api`;

const FACE_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#e91e63', '#00bcd4', '#8bc34a',
];

function faceColor(clusterId) {
  if (!clusterId) return '#FFD700'; // bright yellow for unidentified faces
  return FACE_COLORS[(clusterId - 1) % FACE_COLORS.length];
}

const PERSON_RE = /^Person_(\d+)$/;

function sortClusters(list) {
  const real = list.filter(c => !PERSON_RE.test(c.name))
                   .sort((a, b) => a.name.localeCompare(b.name));
  const auto = list.filter(c => PERSON_RE.test(c.name))
                   .sort((a, b) => {
                     const na = parseInt(PERSON_RE.exec(a.name)[1]);
                     const nb = parseInt(PERSON_RE.exec(b.name)[1]);
                     return na - nb;
                   });
  return [...real, ...auto];
}

function parseFilter(val) {
  if (val && val.startsWith('person:')) {
    return { type: 'person', personId: parseInt(val.split(':')[1]) };
  }
  return { type: val || 'all', personId: null };
}

export default function FaceEditor({ afterTagOperation }) {
  // ── Person panel ─────────────────────────────────────────────────────────
  const [clusters, setClusters] = useState([]);
  const [search, setSearch]     = useState('');

  // ── Photo navigation ──────────────────────────────────────────────────────
  const [filterValue, setFilterValue] = useState('unidentified');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages]   = useState(0);
  const [currentPhoto, setCurrentPhoto] = useState(null);
  const [loading, setLoading]           = useState(false);

  // ── Face selection ────────────────────────────────────────────────────────
  const [selectedFaceId, setSelectedFaceId] = useState(null);
  const [scaledFaces, setScaledFaces]       = useState([]);

  const imgRef      = useRef(null);
  const photoAreaRef = useRef(null);

  // ── Clusters ──────────────────────────────────────────────────────────────

  const fetchClusters = useCallback(() => {
    fetch(`${API}/people/clusters`)
      .then(r => r.json())
      .then(data => setClusters(sortClusters(data)))
      .catch(console.error);
  }, []);

  useEffect(() => { fetchClusters(); }, [fetchClusters]);

  // ── Photo fetching ────────────────────────────────────────────────────────

  const fetchPhoto = useCallback((page, filter) => {
    setLoading(true);
    const { type, personId } = parseFilter(filter);
    let url = `${API}/face-editor/photos?filter=${type}&page=${page}`;
    if (personId) url += `&person_id=${personId}`;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        setCurrentPhoto(data.photo);
        setTotalPages(data.pages || 0);
        setSelectedFaceId(null);
        setScaledFaces([]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchPhoto(currentPage, filterValue); },
    [currentPage, filterValue, fetchPhoto]);

  // ── Bbox scaling using getBoundingClientRect ──────────────────────────────
  // Face boxes are positioned absolutely within .fe-photo-area.
  // The img offset from the area is computed each time.

  const computeBoxPositions = useCallback(() => {
    const img  = imgRef.current;
    const area = photoAreaRef.current;
    if (!img || !area || !currentPhoto?.image_width || !img.clientWidth) {
      setScaledFaces([]);
      return;
    }
    const areaRect = area.getBoundingClientRect();
    const imgRect  = img.getBoundingClientRect();
    const ox = imgRect.left - areaRect.left;
    const oy = imgRect.top  - areaRect.top;
    const sx = img.clientWidth  / currentPhoto.image_width;
    const sy = img.clientHeight / currentPhoto.image_height;

    setScaledFaces((currentPhoto.faces || []).map(f => ({
      ...f,
      x: ox + f.bbox_left  * sx,
      y: oy + f.bbox_top   * sy,
      w: (f.bbox_right  - f.bbox_left) * sx,
      h: (f.bbox_bottom - f.bbox_top)  * sy,
    })));
  }, [currentPhoto]);

  // Recompute when photo data changes
  useEffect(() => { computeBoxPositions(); }, [computeBoxPositions]);

  // Recompute when container resizes (window resize, panel resize)
  useEffect(() => {
    const area = photoAreaRef.current;
    if (!area) return;
    const ro = new ResizeObserver(computeBoxPositions);
    ro.observe(area);
    return () => ro.disconnect();
  }, [computeBoxPositions]);

  // ── Right-click → manual face ─────────────────────────────────────────────

  function handleRightClick(e) {
    e.preventDefault();
    const img = imgRef.current;
    if (!img || !currentPhoto?.image_width) return;
    const imgRect = img.getBoundingClientRect();
    const relX = e.clientX - imgRect.left;
    const relY = e.clientY - imgRect.top;
    if (relX < 0 || relY < 0 || relX > img.clientWidth || relY > img.clientHeight) return;
    const scaleX = currentPhoto.image_width  / img.clientWidth;
    const scaleY = currentPhoto.image_height / img.clientHeight;
    createManualFace(relX * scaleX, relY * scaleY, 50 * Math.max(scaleX, scaleY));
  }

  async function createManualFace(x, y, radius) {
    const res = await fetch(`${API}/people/faces/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_id: currentPhoto.id, x, y, radius, cluster_id: null }),
    });
    const data = await res.json();
    setCurrentPhoto(prev => ({
      ...prev,
      faces: [...prev.faces, {
        face_id: data.face_id, cluster_id: null, person_name: null,
        bbox_top: data.bbox_top, bbox_right: data.bbox_right,
        bbox_bottom: data.bbox_bottom, bbox_left: data.bbox_left, manual: true,
      }],
    }));
    afterTagOperation();
  }

  // ── Face actions ──────────────────────────────────────────────────────────

  const selectedFace = scaledFaces.find(f => f.face_id === selectedFaceId);
  const assignMode   = !!selectedFaceId; // left panel is in assign mode when a face is selected

  function refresh() {
    setSelectedFaceId(null);
    fetchPhoto(currentPage, filterValue);
    fetchClusters();
    afterTagOperation();
  }

  // Called when a person is clicked in assign mode
  async function handleAssignToExisting(clusterId) {
    if (!selectedFaceId) return;
    await fetch(`${API}/people/faces/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ face_id: selectedFaceId, cluster_id: clusterId }),
    });
    refresh();
  }

  async function handleAssignToNew() {
    if (!selectedFaceId) return;
    const r = await fetch(`${API}/people/clusters/create`, { method: 'POST' });
    const newCluster = await r.json();
    await fetch(`${API}/people/faces/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ face_id: selectedFaceId, cluster_id: newCluster.id }),
    });
    refresh();
  }

  async function handleDeleteFace() {
    if (!selectedFaceId) return;
    await fetch(`${API}/people/faces/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ face_id: selectedFaceId }),
    });
    refresh();
  }

  // Called when a person is clicked in filter mode (no face selected)
  function handleFilterByPerson(clusterId) {
    const val = `person:${clusterId}`;
    // Toggle: clicking the active filter clears it
    setFilterValue(filterValue === val ? 'all' : val);
    setCurrentPage(1);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const filteredClusters = clusters.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fe-container">
      <div className="fe-main">

        {/* ── Left: Person panel ── */}
        <div className={`fe-person-panel${assignMode ? ' fe-assign-mode' : ''}`}>
          <div className={`fe-panel-header${assignMode ? ' fe-panel-assign' : ''}`}>
            {assignMode ? 'Assign to Person' : 'Filter by Person'}
          </div>
          <input className="fe-search" placeholder="Search people…"
            value={search} onChange={e => setSearch(e.target.value)} />
          <div className="fe-person-list">
            {filteredClusters.map(c => {
              const isActiveFilter = !assignMode && filterValue === `person:${c.id}`;
              return (
                <div key={c.id}
                  className={`fe-person-item${isActiveFilter ? ' active' : ''}`}
                  onClick={() => assignMode
                    ? handleAssignToExisting(c.id)
                    : handleFilterByPerson(c.id)}
                >
                  <span className="fe-person-dot" style={{ background: faceColor(c.id) }} />
                  <span className="fe-person-name" title={c.name}>{c.name}</span>
                  <span className="fe-person-count">{c.face_count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right: Photo panel ── */}
        <div className="fe-photo-panel">

          {/* Photo display — fills all available space, never scrolls */}
          <div
            className="fe-photo-area"
            ref={photoAreaRef}
            onContextMenu={handleRightClick}
            onClick={() => setSelectedFaceId(null)}
          >
            {loading && <div className="fe-state-msg">Loading…</div>}

            {!loading && !currentPhoto &&
              <div className="fe-state-msg">No photos match the current filter.</div>}

            {!loading && currentPhoto && (
              <img
                ref={imgRef}
                key={currentPhoto.id}
                className="fe-photo-img"
                src={`${API_BASE}/api/photos/full/${currentPhoto.id}`}
                alt={currentPhoto.filename}
                onLoad={computeBoxPositions}
              />
            )}

            {/* Face bounding boxes — positioned relative to photo area */}
            {scaledFaces.map(face => {
              const color      = faceColor(face.cluster_id);
              const isSelected = face.face_id === selectedFaceId;
              const isCircle   = !!face.manual;
              return (
                <div
                  key={face.face_id}
                  className={[
                    'fe-face-box',
                    isSelected ? 'fe-selected' : '',
                    isCircle   ? 'fe-circle'   : '',
                  ].filter(Boolean).join(' ')}
                  style={{
                    left: face.x, top: face.y, width: face.w, height: face.h,
                    borderColor: color,
                  }}
                  onClick={e => {
                    e.stopPropagation();
                    setSelectedFaceId(face.face_id === selectedFaceId ? null : face.face_id);
                  }}
                >
                  <span className="fe-face-label" style={{ background: color }}>
                    {face.person_name || '?'}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Action panel — fixed height, always visible */}
          <div className="fe-action-panel">
            {selectedFace ? (
              <>
                <div className="fe-action-who">
                  <span className="fe-action-dot" style={{ background: faceColor(selectedFace.cluster_id) }} />
                  <span>Selected: <strong>{selectedFace.person_name || '?'}</strong></span>
                  {selectedFace.manual && <span className="fe-manual-tag">manual</span>}
                </div>
                <div className="fe-action-btns">
                  <button className="fe-btn" onClick={handleAssignToNew}>+ New person</button>
                  <button className="fe-btn fe-btn-delete" onClick={handleDeleteFace}>🗑 Delete</button>
                </div>
              </>
            ) : (
              <div className="fe-action-idle">
                <span>Click a face to select it</span>
                <span className="fe-sep">·</span>
                <span>Right-click photo to add a manual face</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom navigation bar ── */}
      <div className="fe-nav-bar">
        {/* Left: filter dropdown */}
        <select className="fe-filter-select" value={filterValue}
          onChange={e => { setFilterValue(e.target.value); setCurrentPage(1); }}>
          <option value="all">All photos with faces</option>
          <option value="unidentified">Photos with ? faces</option>
          <optgroup label="By person">
            {clusters.map(c => (
              <option key={c.id} value={`person:${c.id}`}>{c.name}</option>
            ))}
          </optgroup>
        </select>

        {/* Centre: Prev | X / Y | Next */}
        <div className="fe-nav-center">
          <button className="fe-nav-btn" disabled={currentPage <= 1}
            onClick={() => setCurrentPage(p => p - 1)}>← Prev</button>
          <span className="fe-nav-counter">
            {totalPages > 0 ? `${currentPage} / ${totalPages}` : '—'}
          </span>
          <button className="fe-nav-btn" disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage(p => p + 1)}>Next →</button>
        </div>

        {/* Right: filename · date */}
        <span className="fe-nav-filename">
          {currentPhoto
            ? <>{currentPhoto.filename}{currentPhoto.date_taken &&
                <> · {new Date(currentPhoto.date_taken).toLocaleDateString()}</>}</>
            : '—'}
        </span>
      </div>
    </div>
  );
}
