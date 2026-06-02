import { useState, useRef, useEffect } from 'react';
import './NewTagDialog.css';
import { API_BASE } from '../config';

const API = `${API_BASE}/api`;

const TAG_TYPES = [
  'location', 'region', 'country',
  'year', 'month', 'season',
  'people', 'event', 'general', 'source',
];

const NEW_CATEGORY_SENTINEL = '__new__';

export default function NewTagDialog({ selectedPhotoIds, onClose, onTagCreated }) {
  const [name, setName] = useState('');
  const [tagType, setTagType] = useState('general');
  const [customCategory, setCustomCategory] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);
  const customRef = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  // Focus the custom input when "New Category..." is chosen
  useEffect(() => {
    if (tagType === NEW_CATEGORY_SENTINEL) customRef.current?.focus();
  }, [tagType]);

  const isCustom = tagType === NEW_CATEGORY_SENTINEL;
  const effectiveTagType = isCustom
    ? customCategory.trim().toLowerCase().replace(/\s+/g, '_')
    : tagType;

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Tag name is required.'); return; }
    if (isCustom && !customCategory.trim()) { setError('Category name is required.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API}/tags/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, tag_type: effectiveTagType }),
      });
      const tag = await res.json();

      if (selectedPhotoIds.length > 0) {
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
      }
      onTagCreated(tag);
    } catch {
      setError('Failed to create tag. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>Create New Tag</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form className="dialog-form" onSubmit={handleSubmit}>
          <label className="dialog-label">
            Tag Name
            <input
              ref={nameRef}
              className="dialog-input"
              value={name}
              onChange={e => { setName(e.target.value); setError(''); }}
              placeholder="e.g. Holiday 2024"
            />
          </label>

          <label className="dialog-label">
            Category
            <select
              className="dialog-select"
              value={tagType}
              onChange={e => { setTagType(e.target.value); setError(''); }}
            >
              {TAG_TYPES.map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
              <option disabled>──────────</option>
              <option value={NEW_CATEGORY_SENTINEL}>New Category…</option>
            </select>
          </label>

          {isCustom && (
            <label className="dialog-label">
              Custom Category Name
              <input
                ref={customRef}
                className="dialog-input"
                value={customCategory}
                onChange={e => { setCustomCategory(e.target.value); setError(''); }}
                placeholder="e.g. album"
              />
              {customCategory.trim() && (
                <span className="dialog-hint">
                  Stored as: <code>{effectiveTagType}</code>
                </span>
              )}
            </label>
          )}

          {error && <p className="dialog-error">{error}</p>}

          {selectedPhotoIds.length > 0 && (
            <p className="dialog-note">
              Tag will be assigned to {selectedPhotoIds.length} selected photo{selectedPhotoIds.length !== 1 ? 's' : ''}.
            </p>
          )}

          <div className="dialog-actions">
            <button type="button" className="tb-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="tb-btn tb-btn-action" disabled={saving}>
              {saving ? 'Creating…' : 'Create Tag'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
