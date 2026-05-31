import { useState } from 'react';
import './TagPanel.css';

const CATEGORY_LABELS = {
  source:   'Source',
  location: 'Location',
  date:     'Date',
  people:   'People',
  event:    'Event',
  general:  'General',
};

export default function TagPanel({ categories, activeFilters, photoCount, onAddFilter, onRemoveFilter }) {
  const [expanded, setExpanded] = useState({ source: true, date: true, location: true });

  const toggle = (type) => setExpanded(prev => ({ ...prev, [type]: !prev[type] }));
  const isActive = (tag) => activeFilters.some(f => f.id === tag.id);

  return (
    <div className="tag-panel">
      <div className="active-filters">
        <div className="active-filters-header">
          <span className="active-filters-label">Active Filters</span>
          <span className="photo-count">
            <strong>{photoCount.toLocaleString()}</strong> photo{photoCount !== 1 ? 's' : ''}
          </span>
        </div>

        {activeFilters.length === 0 ? (
          <p className="no-filters">No filters — showing all photos</p>
        ) : (
          <div className="filter-chips">
            {activeFilters.map(tag => (
              <span key={tag.id} className={`filter-chip type-${tag.tag_type}`}>
                {tag.name}
                <button
                  className="filter-chip-remove"
                  onClick={() => onRemoveFilter(tag.id)}
                  title="Remove filter"
                >×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="categories">
        {Object.entries(CATEGORY_LABELS).map(([type, label]) => {
          const tags = categories[type] || [];
          if (tags.length === 0) return null;
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
                    <li
                      key={tag.id}
                      className={`tag-item ${isActive(tag) ? 'active' : ''}`}
                      onClick={() => !isActive(tag) && onAddFilter({ ...tag, tag_type: type })}
                    >
                      <span className="tag-name">{tag.name}</span>
                      <span className="tag-count">{tag.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
