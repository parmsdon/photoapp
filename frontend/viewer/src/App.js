import { useState, useEffect, useCallback } from 'react';
import './App.css';
import TagPanel from './components/TagPanel';
import PhotoViewer from './components/PhotoViewer';
import { API_BASE } from './config';

const API = `${API_BASE}/api`;

export default function App() {
  const [activeFilters, setActiveFilters] = useState([]); // [{id, name, tag_type}]
  const [photos, setPhotos] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1, per_page: 50 });
  const [viewMode, setViewMode] = useState('grid');
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  const fetchPhotos = useCallback((filters, page) => {
    const tagIds = filters.map(f => f.id).join(',');
    const params = new URLSearchParams({ page, per_page: 50 });
    if (tagIds) params.set('tags', tagIds);
    fetch(`${API}/photos/filter?${params}`)
      .then(r => r.json())
      .then(data => {
        setPhotos(data.photos);
        setPagination({ total: data.total, page: data.page, pages: data.pages, per_page: data.per_page });
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetchPhotos(activeFilters, 1);
  }, [activeFilters, fetchPhotos]);

  const addFilter = useCallback((tag) => {
    setActiveFilters(prev =>
      prev.find(f => f.id === tag.id) ? prev : [...prev, tag]
    );
  }, []);

  const removeFilter = useCallback((tagId) => {
    setActiveFilters(prev => prev.filter(f => f.id !== tagId));
  }, []);

  const handlePageChange = useCallback((page) => {
    fetchPhotos(activeFilters, page);
  }, [activeFilters, fetchPhotos]);

  const currentIndex = selectedPhoto ? photos.findIndex(p => p.id === selectedPhoto.id) : -1;

  useEffect(() => {
    if (!selectedPhoto) return;
    const handler = (e) => {
      if (e.key === 'Escape') setSelectedPhoto(null);
      if (e.key === 'ArrowLeft' && currentIndex > 0) setSelectedPhoto(photos[currentIndex - 1]);
      if (e.key === 'ArrowRight' && currentIndex < photos.length - 1) setSelectedPhoto(photos[currentIndex + 1]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedPhoto, currentIndex, photos]);

  return (
    <div className="app">
      <div className="tag-panel-wrapper">
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
        />
      </div>

      {selectedPhoto && (
        <div className="lightbox" onClick={() => setSelectedPhoto(null)}>
          <button className="lightbox-close" onClick={() => setSelectedPhoto(null)}>✕</button>
          <button
            className="lightbox-nav prev"
            disabled={currentIndex <= 0}
            onClick={e => { e.stopPropagation(); setSelectedPhoto(photos[currentIndex - 1]); }}
          >‹</button>
          <img
            className="lightbox-img"
            src={`${API}/photos/full/${selectedPhoto.id}`}
            alt={selectedPhoto.filename}
            onClick={e => e.stopPropagation()}
          />
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
