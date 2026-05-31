import './PhotoViewer.css';
import PhotoGrid from './PhotoGrid';
import PhotoStrip from './PhotoStrip';

export default function PhotoViewer({ photos, viewMode, onToggleView, onSelectPhoto, pagination, onPageChange }) {
  const { total, page, pages } = pagination;

  return (
    <div className="photo-viewer">
      <div className="viewer-toolbar">
        <span className="viewer-count">
          {total.toLocaleString()} photo{total !== 1 ? 's' : ''}
          {pages > 1 && ` · page ${page} of ${pages}`}
        </span>

        <div className="view-toggle">
          <button
            className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => viewMode !== 'grid' && onToggleView()}
          >
            Grid
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'strip' ? 'active' : ''}`}
            onClick={() => viewMode !== 'strip' && onToggleView()}
          >
            Strip
          </button>
        </div>
      </div>

      <div className="viewer-content">
        {viewMode === 'grid'
          ? <PhotoGrid photos={photos} onSelectPhoto={onSelectPhoto} />
          : <PhotoStrip photos={photos} onSelectPhoto={onSelectPhoto} />
        }
      </div>

      {pages > 1 && (
        <div className="pagination">
          <button
            className="pagination-btn"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >← Prev</button>
          <span className="pagination-info">Page {page} of {pages}</span>
          <button
            className="pagination-btn"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
          >Next →</button>
        </div>
      )}
    </div>
  );
}
