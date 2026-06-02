import { useState, useEffect, useRef } from 'react';
import './AssignTagModal.css';
import { API_BASE } from '../config';

const API = `${API_BASE}/api`;

const CATEGORY_LABELS = {
  location: 'Town/City', region: 'Region',  country: 'Country',
  year: 'Year', month: 'Month', season: 'Season',
  people: 'People', event: 'Event', general: 'General', source: 'Source',
};

export default function AssignTagModal({ selectedPhotoIds, onClose, onTagAssigned, onNewTag, archiveTagId }) {
  const [categories, setCategories] = useState({});
  const [recentTagIds, setRecentTagIds] = useState([]);
  const [search, setSearch] = useState('');
  const searchRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/tags/all`).then(r => r.json()).then(setCategories).catch(console.error);
    fetch(`${API}/tags/recent`).then(r => r.json()).then(d => setRecentTagIds(d.tag_ids || [])).catch(console.error);
    searchRef.current?.focus();
  }, []);

  const isArchive = (tag) => archiveTagId != null && tag.id === archiveTagId;

  const allTagsFlat = Object.entries(categories).flatMap(([type, tags]) =>
    tags.map(t => ({ ...t, tag_type: type }))
  ).filter(t => !isArchive(t));

  const recentTags = recentTagIds
    .slice(0, 3)
    .map(id => allTagsFlat.find(t => t.id === id))
    .filter(Boolean);

  const matches = (tag) => tag.name.toLowerCase().includes(search.toLowerCase());

  async function handleAssign(tag) {
    await fetch(`${API}/photos/assign-tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_ids: selectedPhotoIds, tag_id: tag.id }),
    });
    await fetch(`${API}/tags/recent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_id: tag.id }),
    });
    onTagAssigned(tag);
  }

  const recentIds = new Set(recentTagIds.slice(0, 3));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>Assign Tag</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <input
          ref={searchRef}
          className="modal-search"
          placeholder="Search tags…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <div className="modal-tag-list">
          {/* New tag */}
          {!search && (
            <div className="modal-tag-item modal-new-tag" onClick={onNewTag}>
              <span className="modal-new-tag-icon">＋</span> New Tag
            </div>
          )}

          {/* Recently used */}
          {!search && recentTags.length > 0 && (
            <>
              <div className="modal-section-label">Recently Used</div>
              {recentTags.filter(matches).map(tag => (
                <div key={tag.id} className="modal-tag-item" onClick={() => handleAssign(tag)}>
                  <span className={`modal-type-dot type-${tag.tag_type}`} />
                  {tag.name}
                </div>
              ))}
            </>
          )}

          {/* All tags grouped by category */}
          {Object.entries(CATEGORY_LABELS).map(([type, label]) => {
            const tags = (categories[type] || [])
              .filter(t => !isArchive(t))
              .filter(t => !recentIds.has(t.id) || !!search)
              .filter(matches);
            if (!tags.length) return null;
            return (
              <div key={type}>
                <div className="modal-section-label">{label}</div>
                {tags.map(tag => (
                  <div key={tag.id} className="modal-tag-item" onClick={() => handleAssign({ ...tag, tag_type: type })}>
                    <span className={`modal-type-dot type-${type}`} />
                    {tag.name}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
