import './RemoveTagModal.css';
import { API_BASE } from '../config';

const API = `${API_BASE}/api`;

function intersectTags(photos) {
  if (!photos.length) return [];
  const sets = photos.map(p => new Set(p.tags.map(t => t.id)));
  const common = [...sets[0]].filter(id => sets.every(s => s.has(id)));
  return photos[0].tags.filter(t => common.includes(t.id));
}

export default function RemoveTagModal({ selectedPhotos, onClose, onTagRemoved }) {
  const commonTags = intersectTags(selectedPhotos);
  const photoIds = selectedPhotos.map(p => p.id);

  async function handleRemove(tag) {
    await fetch(`${API}/photos/remove-tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_ids: photoIds, tag_id: tag.id }),
    });
    onTagRemoved(tag);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>Remove Tag</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="remove-modal-info">
          Tags present on all {selectedPhotos.length} selected photo{selectedPhotos.length !== 1 ? 's' : ''}:
        </div>

        <div className="modal-tag-list">
          {commonTags.length === 0
            ? <div className="remove-modal-empty">No tags are common to all selected photos.</div>
            : commonTags.map(tag => (
                <div key={tag.id} className="remove-tag-item">
                  <span className={`modal-type-dot type-${tag.tag_type}`} />
                  <span className="remove-tag-name">{tag.name}</span>
                  <span className="remove-tag-type">{tag.tag_type}</span>
                  <button className="remove-tag-btn" onClick={() => handleRemove(tag)}>Remove</button>
                </div>
              ))
          }
        </div>
      </div>
    </div>
  );
}
