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

// ── Grid page-size calculation (matches FaceEditor.css grid constants) ──────

const FE_GRID_PAD = 3;
const FE_GRID_GAP = 3;
const FE_GRID_MIN = 160; // min cell width

function calcGridPageSize(w, h) {
  const cols  = Math.max(1, Math.floor((w - FE_GRID_PAD * 2 + FE_GRID_GAP) / (FE_GRID_MIN + FE_GRID_GAP)));
  const cellW = (w - FE_GRID_PAD * 2 - (cols - 1) * FE_GRID_GAP) / cols;
  const rows  = Math.max(1, Math.floor((h - FE_GRID_PAD * 2 + FE_GRID_GAP) / (cellW + FE_GRID_GAP)));
  return cols * rows;
}

// Scale face bboxes in object-fit:cover thumbnail space
function computeCoverBoxes(img, faces) {
  if (!img || !img.naturalWidth || !faces.length || !faces[0].image_width) return [];
  const iw = faces[0].image_width;
  const toThumb = img.naturalWidth / iw;
  const cw = img.clientWidth;
  const ch = img.clientHeight;
  const cs = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
  const ox = (cw - img.naturalWidth * cs) / 2;
  const oy = (ch - img.naturalHeight * cs) / 2;
  return faces.map(f => ({
    id: f.face_id, cluster_id: f.cluster_id, person_name: f.person_name,
    x: f.bbox_left * toThumb * cs + ox,
    y: f.bbox_top  * toThumb * cs + oy,
    w: (f.bbox_right  - f.bbox_left) * toThumb * cs,
    h: (f.bbox_bottom - f.bbox_top)  * toThumb * cs,
  }));
}

// ── GridThumb — thumbnail card with face-box overlays ────────────────────────

function GridThumb({ photo, singleIndex, onNavigate }) {
  const [boxes, setBoxes] = useState([]);
  const imgRef = useRef(null);

  const compute = useCallback(() => {
    setBoxes(computeCoverBoxes(imgRef.current, photo.faces));
  }, [photo.faces]);

  useEffect(() => { compute(); }, [compute]);

  return (
    <div className="fe-grid-thumb" onClick={() => onNavigate(singleIndex)}>
      <img
        ref={imgRef}
        src={`${API_BASE}/api/photos/thumbnail/${photo.id}`}
        alt={photo.filename}
        loading="lazy"
        onLoad={compute}
      />
      {boxes.map(box => (
        <div key={box.id} className="fe-grid-face-box"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h, borderColor: faceColor(box.cluster_id) }} />
      ))}
      <div className="fe-grid-thumb-overlay">
        <span className="fe-grid-thumb-name">{photo.filename}</span>
        {photo.date_taken && (
          <span className="fe-grid-thumb-date">{new Date(photo.date_taken).toLocaleDateString()}</span>
        )}
      </div>
    </div>
  );
}

export default function FaceEditor({ afterTagOperation }) {
  // ── Person panel ─────────────────────────────────────────────────────────
  const [clusters, setClusters] = useState([]);
  const [search, setSearch]     = useState('');
  const searchRef               = useRef(null);

  // ── View mode ─────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState('single'); // 'single' | 'grid'

  // ── Photo navigation ──────────────────────────────────────────────────────
  const [filterValue, setFilterValue] = useState('unidentified');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages]   = useState(0);
  const [currentPhoto, setCurrentPhoto] = useState(null);
  const [loading, setLoading]           = useState(false);

  // ── Grid mode state ───────────────────────────────────────────────────────
  const [gridPhotos, setGridPhotos]   = useState([]);
  const [gridPage, setGridPage]       = useState(1);
  const [gridPageSize, setGridPageSize] = useState(12);
  const [gridPages, setGridPages]     = useState(0);
  const [gridLoading, setGridLoading] = useState(false);
  const gridRef      = useRef(null);
  const lastGridSize = useRef(0);
  const gridDebounce = useRef(null);

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
        const total = data.total || 0;
        const pages = data.pages || 0;

        // If we're past the end of the list (e.g. last photo was removed),
        // clamp to the new last valid page and let the effect refetch.
        if (data.photo === null && total > 0 && page > total) {
          setTotalPages(total);
          setCurrentPage(total); // triggers useEffect → fetchPhoto(total, filter)
          setLoading(false);
          return;
        }

        setCurrentPhoto(data.photo); // null → clean empty state
        setTotalPages(pages);
        setSelectedFaceId(null);
        setScaledFaces([]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (viewMode === 'single') fetchPhoto(currentPage, filterValue);
  }, [currentPage, filterValue, fetchPhoto, viewMode]);

  const fetchGridPhotos = useCallback((page, perPage, filter) => {
    setGridLoading(true);
    const { type, personId } = parseFilter(filter);
    let url = `${API}/face-editor/photos?filter=${type}&page=${page}&per_page=${perPage}`;
    if (personId) url += `&person_id=${personId}`;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        setGridPhotos(data.photos || []);
        setGridPages(data.pages || 0);
        setGridLoading(false);
      })
      .catch(() => setGridLoading(false));
  }, []);

  useEffect(() => {
    if (viewMode === 'grid' && gridPageSize > 0) {
      fetchGridPhotos(gridPage, gridPageSize, filterValue);
    }
  }, [viewMode, gridPage, gridPageSize, filterValue, fetchGridPhotos]);

  // ResizeObserver for grid page size
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width < 100 || height < 100) return;
      const newSize = calcGridPageSize(width, height);
      if (newSize === lastGridSize.current) return;
      lastGridSize.current = newSize;
      clearTimeout(gridDebounce.current);
      gridDebounce.current = setTimeout(() => {
        setGridPageSize(newSize);
        setGridPage(1);
      }, 150);
    });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(gridDebounce.current); };
  }, [viewMode]); // re-attach when switching to grid (el may not have been rendered before)

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

  // Delete key shortcut — same action as the Delete button when a face is selected
  useEffect(() => {
    if (!selectedFaceId) return;
    const handler = e => {
      if (e.key !== 'Delete') return;
      // Ignore if focus is inside an input / select / textarea
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      handleDeleteFace();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedFaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Switch from single → grid, keeping the grid page that contains the current photo
  function switchToGrid() {
    const targetGridPage = gridPageSize > 0 ? Math.ceil(currentPage / gridPageSize) : 1;
    setGridPage(targetGridPage);
    setViewMode('grid');
  }

  // Click a grid thumbnail → navigate to that photo in single mode
  // singleIndex is the 1-based index across ALL filtered photos
  function navigateToSingle(singleIndex) {
    setCurrentPage(singleIndex);
    setViewMode('single');
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
            {assignMode
              ? 'Assign to Person'
              : <><span>Assign to Person</span><span className="fe-panel-idle-hint"> — select a face first</span></>}
          </div>
          <div className="fe-search-wrap">
            <input ref={searchRef} className="fe-search" placeholder="Search people…"
              value={search} onChange={e => setSearch(e.target.value)} />
            {search && (
              <button className="fe-search-clear" tabIndex={-1}
                onClick={() => { setSearch(''); searchRef.current?.focus(); }}>×</button>
            )}
          </div>
          <div className="fe-person-list">
            {filteredClusters.map(c => (
              <div key={c.id}
                className={`fe-person-item${assignMode ? '' : ' fe-person-disabled'}`}
                onClick={() => assignMode ? handleAssignToExisting(c.id) : undefined}
              >
                <span className="fe-person-dot" style={{ background: faceColor(c.id) }} />
                <span className="fe-person-name" title={c.name}>{c.name}</span>
                <span className="fe-person-count">{c.face_count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right: Photo panel or Grid ── */}
        <div className="fe-photo-panel">

          {/* Grid view */}
          {viewMode === 'grid' && (
            <div className="fe-grid-area" ref={gridRef}>
              {gridLoading && <div className="fe-state-msg">Loading…</div>}
              {!gridLoading && gridPhotos.length === 0 && (
                <div className="fe-state-msg">No photos match the current filter.</div>
              )}
              {!gridLoading && gridPhotos.map((photo, i) => {
                const singleIndex = (gridPage - 1) * gridPageSize + i + 1;
                return (
                  <GridThumb
                    key={photo.id}
                    photo={photo}
                    singleIndex={singleIndex}
                    onNavigate={navigateToSingle}
                  />
                );
              })}
            </div>
          )}

          {/* Photo display — fills all available space, never scrolls */}
          {viewMode === 'single' && (
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
          )} {/* end single view */}

          {/* Action panel — fixed height, single view only */}
          {viewMode === 'single' &&
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
          </div>}
        </div>
      </div>

      {/* ── Bottom navigation bar ── */}
      <div className="fe-nav-bar">
        {/* Left: filter + view toggle */}
        <div className="fe-nav-left-group">
          <select className="fe-filter-select" value={filterValue}
            onChange={e => { setFilterValue(e.target.value); setCurrentPage(1); setGridPage(1); }}>
            <option value="all">All Photos</option>
            <option value="faces">All Photos with Faces</option>
            <option value="unidentified">Photos with ? Faces</option>
            <optgroup label="By person">
              {clusters.map(c => (
                <option key={c.id} value={`person:${c.id}`}>{c.name}</option>
              ))}
            </optgroup>
          </select>
          <button
            className={`fe-nav-btn fe-view-toggle${viewMode === 'grid' ? ' active' : ''}`}
            onClick={() => viewMode === 'single' ? switchToGrid() : setViewMode('single')}
            title={viewMode === 'single' ? 'Switch to grid view' : 'Switch to single view'}
          >
            {viewMode === 'single' ? '⊞ Grid' : '⊟ Single'}
          </button>
        </div>

        {/* Centre: navigation (adapts to view mode) */}
        <div className="fe-nav-center">
          {viewMode === 'single' ? (
            <>
              <button className="fe-nav-btn fe-nav-jump" disabled={currentPage <= 10}
                onClick={() => setCurrentPage(p => Math.max(1, p - 10))}>−10</button>
              <button className="fe-nav-btn" disabled={currentPage <= 1}
                onClick={() => setCurrentPage(p => p - 1)}>← Prev</button>
              <span className="fe-nav-counter">
                {totalPages > 0 ? `${currentPage} / ${totalPages}` : '—'}
              </span>
              <button className="fe-nav-btn" disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(p => p + 1)}>Next →</button>
              <button className="fe-nav-btn fe-nav-jump" disabled={currentPage > totalPages - 10}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 10))}>+10</button>
            </>
          ) : (
            <>
              <button className="fe-nav-btn fe-nav-jump" disabled={gridPage <= 10}
                onClick={() => setGridPage(p => Math.max(1, p - 10))}>−10</button>
              <button className="fe-nav-btn" disabled={gridPage <= 1}
                onClick={() => setGridPage(p => p - 1)}>← Prev</button>
              <span className="fe-nav-counter">
                {gridPages > 0 ? `${gridPage} / ${gridPages}` : '—'}
              </span>
              <button className="fe-nav-btn" disabled={gridPage >= gridPages}
                onClick={() => setGridPage(p => p + 1)}>Next →</button>
              <button className="fe-nav-btn fe-nav-jump" disabled={gridPage > gridPages - 10}
                onClick={() => setGridPage(p => Math.min(gridPages, p + 10))}>+10</button>
            </>
          )}
        </div>

        {/* Right: filename (single) or photo count (grid) */}
        <span className="fe-nav-filename">
          {viewMode === 'single'
            ? currentPhoto
              ? <>{currentPhoto.filename}{currentPhoto.date_taken &&
                  <> · {new Date(currentPhoto.date_taken).toLocaleDateString()}</>}</>
              : '—'
            : gridPhotos.length > 0
              ? `${gridPhotos.length} photo${gridPhotos.length !== 1 ? 's' : ''} on page`
              : '—'
          }
        </span>
      </div>
    </div>
  );
}
