import { useState, useEffect } from 'react';
import './TagPanel.css';
import { API_BASE } from '../config';

const API = `${API_BASE}/api`;

const CATEGORY_LABELS = {
  location: 'Town/City', region: 'Region',   country: 'Country',
  year:     'Year',      month:  'Month',     season:  'Season',
  people:   'People',    event:  'Event',     general: 'General',
  source:   'Source',
};

const EXPANDED_KEY = 'photoapp-manager-tag-expanded';

export default function TagPanel({ activeFilters, photoCount, onAddFilter, onRemoveFilter, refreshTrigger, onDeleteTag }) {
  const [categories, setCategories] = useState({});
  const [expanded, setExpanded] = useState(() => {
    try { return JSON.parse(localStorage.getItem(EXPANDED_KEY) || '{}'); }
    catch { return {}; }
  });
  const [pendingDelete, setPendingDelete] = useState(null); // {tag, type, count}

  useEffect(() => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded));
  }, [expanded]);

  useEffect(() => {
    const tagIds = activeFilters.map(f => f.id).join(',');
    const url = tagIds ? `${API}/tags/available?tags=${tagIds}` : `${API}/tags/available`;
    fetch(url).then(r => r.json()).then(setCategories).catch(console.error);
  }, [activeFilters, refreshTrigger]);

  const toggle   = (type) => setExpanded(prev => ({ ...prev, [type]: !prev[type] }));
  const isActive = (tag)  => activeFilters.some(f => f.id === tag.id);
  const isContextual = activeFilters.length > 0;

  function confirmDelete() {
    onDeleteTag(pendingDelete.tag);
    setPendingDelete(null);
  }

  return (
    <div className="tag-panel">
      <div className="active-filters">
        <div className="active-filters-header">
          <span className="active-filters-label">Active Filters</span>
          <span className="photo-count">
            <strong>{photoCount.toLocaleString()}</strong> photo{photoCount !== 1 ? 's' : ''}
          </span>
        </div>
        {activeFilters.length === 0
          ? <p className="no-filters">No filters — showing all photos</p>
          : <div className="filter-chips">
              {activeFilters.map(tag => (
                <span key={tag.id} className={`filter-chip type-${tag.tag_type}`}>
                  {tag.name}
                  <button className="filter-chip-remove" onClick={() => onRemoveFilter(tag.id)}>×</button>
                </span>
              ))}
            </div>
        }
      </div>

      <div className="categories">
        {Object.entries(CATEGORY_LABELS).map(([type, label]) => {
          const tags = categories[type] || [];
          if (!tags.length) return null;
          const isOpen = !!expanded[type];
          return (
            <div className="category" key={type}>
              <button className="category-header" onClick={() => toggle(type)}>
                <span className={`category-dot type-${type}`} />
                {label}
                <span className="category-count">{tags.length}</span>
                <span className={`category-chevron ${isOpen ? 'open' : ''}`}>▶</span>
              </button>
              {isOpen && (
                <ul className="tag-list">
                  {tags.map(tag => (
                    <li key={tag.id}
                      className={`tag-item ${isActive(tag) ? 'active' : ''}`}
                      onClick={() => !isActive(tag) && onAddFilter({ ...tag, tag_type: type })}
                    >
                      <span className="tag-name">{tag.name}</span>
                      <span className={`tag-count${isContextual ? ' contextual' : ''}`}>{tag.count}</span>
                      {onDeleteTag && type !== 'people' && (
                        <button
                          className="tag-delete-btn"
                          title={`Delete tag "${tag.name}"`}
                          onClick={e => { e.stopPropagation(); setPendingDelete({ tag: { ...tag, tag_type: type }, count: tag.count }); }}
                        >×</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* Confirmation dialog */}
      {pendingDelete && (
        <div className="delete-confirm-overlay" onClick={() => setPendingDelete(null)}>
          <div className="delete-confirm-box" onClick={e => e.stopPropagation()}>
            <p className="delete-confirm-title">Delete tag?</p>
            <p className="delete-confirm-msg">
              <strong>"{pendingDelete.tag.name}"</strong> will be removed from{' '}
              <strong>{pendingDelete.count}</strong> photo{pendingDelete.count !== 1 ? 's' : ''}.
              This cannot be undone.
            </p>
            <div className="delete-confirm-actions">
              <button className="dc-btn dc-cancel" onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="dc-btn dc-delete" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
