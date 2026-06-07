import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import TagPanel from './components/TagPanel';
import PhotoViewer from './components/PhotoViewer';
import { API_BASE } from './config';
import { faceColor } from './utils/faceColours';

const API = `${API_BASE}/api`;

export default function App() {
  // ── Settings (persisted) ───────────────────────────────────────────────
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem('photoapp-dark') !== 'false'
  );
  const [largeFont, setLargeFont] = useState(
    () => localStorage.getItem('photoapp-large-font') === 'true'
  );

  useEffect(() => {
    document.documentElement.classList.toggle('light-mode', !darkMode);
    localStorage.setItem('photoapp-dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem('photoapp-large-font', largeFont);
  }, [largeFont]);

  // ── Photos & filters ───────────────────────────────────────────────────
  const [activeFilters, setActiveFilters] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1, per_page: 50 });
  const [viewMode, setViewMode] = useState('grid');
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [pageSize, setPageSize] = useState(50);

  const fetchPhotos = useCallback((filters, page, perPage) => {
    const tagIds = filters.map(f => f.id).join(',');
    const params = new URLSearchParams({ page, per_page: perPage });
    if (tagIds) params.set('tags', tagIds);
    fetch(`${API}/photos/filter?${params}`)
      .then(r => r.json())
      .then(data => {
        setPhotos(data.photos);
        setPagination({ total: data.total, page: data.page, pages: data.pages, per_page: data.per_page });
      })
      .catch(console.error);
  }, []);

  useEffect(() => { fetchPhotos(activeFilters, 1, pageSize); }, [activeFilters, fetchPhotos, pageSize]);

  const addFilter            = useCallback((tag)     => setActiveFilters(prev => prev.find(f => f.id === tag.id) ? prev : [...prev, tag]), []);
  const removeFilter         = useCallback((id)      => setActiveFilters(prev => prev.filter(f => f.id !== id)), []);
  const handlePageChange     = useCallback((page)    => fetchPhotos(activeFilters, page, pageSize), [activeFilters, fetchPhotos, pageSize]);
  const handlePageSizeChange = useCallback((newSize) => setPageSize(newSize), []);

  // ── Lightbox keyboard nav ──────────────────────────────────────────────
  const currentIndex = selectedPhoto ? photos.findIndex(p => p.id === selectedPhoto.id) : -1;

  useEffect(() => {
    if (!selectedPhoto) return;
    const handler = (e) => {
      if (e.key === 'Escape')      setSelectedPhoto(null);
      if (e.key === 'ArrowLeft'  && currentIndex > 0)                 setSelectedPhoto(photos[currentIndex - 1]);
      if (e.key === 'ArrowRight' && currentIndex < photos.length - 1) setSelectedPhoto(photos[currentIndex + 1]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedPhoto, currentIndex, photos]);

  // ── Lightbox face overlay ──────────────────────────────────────────────
  // showFaces is the canonical "show face boxes" preference shared across
  // the grid and the lightbox. The lightbox inherits this value on open.
  const [showFaces, setShowFaces] = useState(false);
  const showFacesRef = useRef(showFaces);
  showFacesRef.current = showFaces;

  const [showLightboxFaces, setShowLightboxFaces] = useState(false);
  const [lightboxFaces, setLightboxFaces] = useState([]);
  const [lightboxImgSize, setLightboxImgSize] = useState({ w: 0, h: 0 });
  const lightboxImgRef    = useRef(null);
  const lightboxFaceCache = useRef({});

  // When the lightbox opens with a new photo, inherit the current showFaces
  // preference so grid and lightbox start in the same state.
  useEffect(() => {
    setLightboxImgSize({ w: 0, h: 0 });
    setLightboxFaces([]);
    if (selectedPhoto) setShowLightboxFaces(showFacesRef.current);
  }, [selectedPhoto, selectedPhoto?.id]);

  // Fetch faces when photo changes or toggle turns on
  useEffect(() => {
    if (!selectedPhoto || !showLightboxFaces) { setLightboxFaces([]); return; }
    if (lightboxFaceCache.current[selectedPhoto.id] !== undefined) {
      setLightboxFaces(lightboxFaceCache.current[selectedPhoto.id]);
      return;
    }
    fetch(`${API}/photos/${selectedPhoto.id}/faces`)
      .then(r => r.json())
      .then(data => {
        lightboxFaceCache.current[selectedPhoto.id] = data;
        setLightboxFaces(data);
      })
      .catch(() => { lightboxFaceCache.current[selectedPhoto.id] = []; });
  }, [selectedPhoto, selectedPhoto?.id, showLightboxFaces]);

  const updateLightboxImgSize = useCallback(() => {
    const img = lightboxImgRef.current;
    if (img) setLightboxImgSize({ w: img.clientWidth, h: img.clientHeight });
  }, []);

  function renderLightboxFaces() {
    if (!showLightboxFaces || !lightboxImgSize.w || !lightboxFaces.length) return null;
    return lightboxFaces.map(face => {
      if (!face.image_width) return null;
      const sx = lightboxImgSize.w / face.image_width;
      const sy = lightboxImgSize.h / face.image_height;
      const color = faceColor(face.cluster_id);
      return (
        <div
          key={face.id}
          style={{
            position: 'absolute',
            left:   face.bbox.left   * sx,
            top:    face.bbox.top    * sy,
            width:  (face.bbox.right  - face.bbox.left)  * sx,
            height: (face.bbox.bottom - face.bbox.top) * sy,
            border: `2px solid ${color}`,
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        >
          <span style={{
            position: 'absolute', top: -22, left: -2,
            background: color, color: '#fff',
            fontSize: 11, fontWeight: 600,
            padding: '1px 6px', borderRadius: '3px 3px 0 0',
            whiteSpace: 'nowrap', lineHeight: '20px',
          }}>
            {face.person_name || '?'}
          </span>
        </div>
      );
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="app">

      <header className="settings-bar">
        <span className="settings-title">PhotoApp</span>
        <div className="settings-controls">
          <button
            className="settings-btn"
            onClick={() => setDarkMode(d => !d)}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? '☀ Light' : '🌙 Dark'}
          </button>
          <button
            className="settings-btn"
            onClick={() => setLargeFont(f => !f)}
            title={largeFont ? 'Use small font' : 'Use large font'}
          >
            {largeFont ? 'A−' : 'A+'}
          </button>
        </div>
      </header>

      <div className="main-content">
        <div className={`tag-panel-wrapper${largeFont ? ' large-font' : ''}`}>
          <TagPanel
            activeFilters={activeFilters}
            photoCount={pagination.total}
            onAddFilter={addFilter}
            onRemoveFilter={removeFilter}
          />
        </div>

        <div className="photo-area">
          <PhotoViewer
            photos={photos}
            viewMode={viewMode}
            onToggleView={() => setViewMode(m => m === 'grid' ? 'navigator' : 'grid')}
            onSelectPhoto={setSelectedPhoto}
            pagination={pagination}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            showFaces={showFaces}
            onToggleShowFaces={() => setShowFaces(f => !f)}
          />
        </div>
      </div>

      {/* ── Lightbox ──────────────────────────────────────────────────── */}
      {selectedPhoto && (
        <div className="lightbox" onClick={() => setSelectedPhoto(null)}>
          <button className="lightbox-close" onClick={() => setSelectedPhoto(null)}>✕</button>
          <button
            className={`lightbox-face-toggle${showLightboxFaces ? ' active' : ''}`}
            onClick={e => { e.stopPropagation(); setShowLightboxFaces(f => !f); }}
          >
            {showLightboxFaces ? 'Hide Faces' : 'Show Faces'}
          </button>

          <button
            className="lightbox-nav prev"
            disabled={currentIndex <= 0}
            onClick={e => { e.stopPropagation(); setSelectedPhoto(photos[currentIndex - 1]); }}
          >‹</button>

          {/* Image + face overlay wrapper — sized to the rendered image */}
          <div
            className="lightbox-img-container"
            style={lightboxImgSize.w ? { width: lightboxImgSize.w, height: lightboxImgSize.h } : undefined}
            onClick={e => e.stopPropagation()}
          >
            <img
              ref={lightboxImgRef}
              className="lightbox-img"
              src={`${API}/photos/full/${selectedPhoto.id}`}
              alt={selectedPhoto.filename}
              onLoad={updateLightboxImgSize}
            />
            {renderLightboxFaces()}
          </div>

          <button
            className="lightbox-nav next"
            disabled={currentIndex >= photos.length - 1}
            onClick={e => { e.stopPropagation(); setSelectedPhoto(photos[currentIndex + 1]); }}
          >›</button>

          <div className="lightbox-info" onClick={e => e.stopPropagation()}>
            <p>{selectedPhoto.filename}</p>
            {selectedPhoto.date_taken && (
              <p>{new Date(selectedPhoto.date_taken).toLocaleDateString(undefined, { dateStyle: 'long' })}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
