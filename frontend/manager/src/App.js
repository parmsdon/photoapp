import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import TagPanel from './components/TagPanel';
import Toolbar from './components/Toolbar';
import ManagerGrid from './components/ManagerGrid';
import AssignTagModal from './components/AssignTagModal';
import RemoveTagModal from './components/RemoveTagModal';
import NewTagDialog from './components/NewTagDialog';
import PeopleManager from './components/PeopleManager';
import FaceEditor from './components/FaceEditor';
import { API_BASE } from './config';

const API = `${API_BASE}/api`;

export default function App() {
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem('photoapp-dark') !== 'false'
  );
  useEffect(() => {
    document.documentElement.classList.toggle('light-mode', !darkMode);
    localStorage.setItem('photoapp-dark', darkMode);
  }, [darkMode]);

  // ── Tab navigation ─────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('photos'); // 'photos' | 'people' | 'faces'

  // ── Archive tag ────────────────────────────────────────────────────────
  const [archiveTagId, setArchiveTagId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const archiveTagIdRef = useRef(null);
  const showArchivedRef = useRef(false);
  archiveTagIdRef.current = archiveTagId;
  showArchivedRef.current = showArchived;

  useEffect(() => {
    fetch(`${API}/tags/archive-id`)
      .then(r => r.json())
      .then(d => setArchiveTagId(d.id ?? null))
      .catch(console.error);
  }, []);

  // ── Photos & filters ───────────────────────────────────────────────────
  const [activeFilters, setActiveFilters] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1, per_page: 50 });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [pageSize, setPageSize] = useState(50);
  const [modal, setModal] = useState(null); // 'assign' | 'remove' | 'new-tag'
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchPhotos = useCallback((filters, page, perPage) => {
    const baseIds = filters.map(f => f.id);
    if (showArchivedRef.current && archiveTagIdRef.current) {
      baseIds.push(archiveTagIdRef.current);
    }
    const tagIds = [...new Set(baseIds)].join(',');
    const params = new URLSearchParams({ page, per_page: perPage });
    if (tagIds) params.set('tags', tagIds);
    fetch(`${API}/photos/filter?${params}`)
      .then(r => r.json())
      .then(data => {
        setPhotos(data.photos);
        setPagination({ total: data.total, page: data.page, pages: data.pages, per_page: data.per_page });
        setSelectedIds(prev => {
          const ids = new Set(data.photos.map(p => p.id));
          return new Set([...prev].filter(id => ids.has(id)));
        });
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetchPhotos(activeFilters, 1, pageSize);
  }, [activeFilters, fetchPhotos, pageSize, showArchived]);

  const addFilter    = useCallback((tag) => setActiveFilters(prev => prev.find(f => f.id === tag.id) ? prev : [...prev, tag]), []);
  const removeFilter = useCallback((id)  => setActiveFilters(prev => prev.filter(f => f.id !== id)), []);
  const handlePageChange     = useCallback((page)    => fetchPhotos(activeFilters, page, pageSize), [activeFilters, fetchPhotos, pageSize]);
  const handlePageSizeChange = useCallback((newSize) => setPageSize(newSize), []);

  const toggleSelect = useCallback((photoId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(photoId) ? next.delete(photoId) : next.add(photoId);
      return next;
    });
  }, []);

  const selectAll   = useCallback(() => setSelectedIds(new Set(photos.map(p => p.id))), [photos]);
  const deselectAll = useCallback(() => setSelectedIds(new Set()), []);

  const selectedPhotos = photos.filter(p => selectedIds.has(p.id));

  const afterTagOperation = useCallback(() => {
    setModal(null);
    setRefreshTrigger(n => n + 1);
    fetchPhotos(activeFilters, pagination.page, pageSize);
  }, [activeFilters, fetchPhotos, pagination.page, pageSize]);

  const handleDeleteTag = useCallback(async (tag) => {
    await fetch(`${API}/tags/${tag.id}`, { method: 'DELETE' });
    afterTagOperation();
  }, [afterTagOperation]);

  const handleArchive = useCallback(async () => {
    if (!archiveTagId || selectedIds.size === 0) return;
    await fetch(`${API}/photos/assign-tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_ids: [...selectedIds], tag_id: archiveTagId }),
    });
    setSelectedIds(new Set());
    afterTagOperation();
  }, [archiveTagId, selectedIds, afterTagOperation]);

  return (
    <div className="app">
      <header className="settings-bar">
        <span className="settings-title">PhotoApp Manager</span>
        <button className="settings-btn" onClick={() => setDarkMode(d => !d)}>
          {darkMode ? '☀ Light' : '🌙 Dark'}
        </button>
      </header>

      {/* ── Full-width tab bar ── */}
      <div className="app-tab-bar">
        {['photos', 'people', 'faces'].map(tab => (
          <button key={tab}
            className={`app-tab-btn${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="main-content">
        {/* Tag panel — Photos tab only */}
        {activeTab === 'photos' && (
          <div className="tag-panel-wrapper">
            <TagPanel
              activeFilters={activeFilters}
              photoCount={pagination.total}
              onAddFilter={addFilter}
              onRemoveFilter={removeFilter}
              refreshTrigger={refreshTrigger}
              onDeleteTag={handleDeleteTag}
            />
          </div>
        )}

        <div className="manager-area">
          {/* Action toolbar — Photos tab only, sits above the grid */}
          {activeTab === 'photos' && (
            <Toolbar
              selectedCount={selectedIds.size}
              totalCount={pagination.total}
              onSelectAll={selectAll}
              onDeselectAll={deselectAll}
              onAssignTag={() => setModal('assign')}
              onRemoveTag={() => setModal('remove')}
              onArchive={handleArchive}
              showArchived={showArchived}
              onToggleShowArchived={() => setShowArchived(v => !v)}
              page={pagination.page}
              pages={pagination.pages}
              onPageChange={handlePageChange}
            />
          )}

          {activeTab === 'photos' && (
            <ManagerGrid
              photos={photos}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onPageSizeChange={handlePageSizeChange}
            />
          )}
          {activeTab === 'people' && (
            <PeopleManager afterTagOperation={afterTagOperation} />
          )}
          {activeTab === 'faces' && (
            <FaceEditor afterTagOperation={afterTagOperation} />
          )}
        </div>
      </div>

      {modal === 'assign' && (
        <AssignTagModal
          selectedPhotoIds={[...selectedIds]}
          onClose={() => setModal(null)}
          onTagAssigned={afterTagOperation}
          onNewTag={() => setModal('new-tag')}
          archiveTagId={archiveTagId}
        />
      )}

      {modal === 'remove' && (
        <RemoveTagModal
          selectedPhotos={selectedPhotos}
          onClose={() => setModal(null)}
          onTagRemoved={afterTagOperation}
        />
      )}

      {modal === 'new-tag' && (
        <NewTagDialog
          selectedPhotoIds={[...selectedIds]}
          onClose={() => setModal(null)}
          onTagCreated={afterTagOperation}
        />
      )}
    </div>
  );
}
