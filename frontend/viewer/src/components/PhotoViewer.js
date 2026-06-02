import './PhotoViewer.css';
import PhotoGrid from './PhotoGrid';
import PhotoNavigator from './PhotoNavigator';

export default function PhotoViewer({
  photos, viewMode, onToggleView, onSelectPhoto,
  pagination, onPageChange, onPageSizeChange,
  showFaces, onToggleShowFaces,
}) {
  const { total, page, pages } = pagination;

  return (
    <div className="photo-viewer">
      <div className="viewer-toolbar">
        <span className="viewer-count">
          {total.toLocaleString()} photo{total !== 1 ? 's' : ''}
          {viewMode === 'grid' && pages > 1 && ` · page ${page} of ${pages}`}
        </span>

        <div className="viewer-toolbar-controls">
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => viewMode !== 'grid' && onToggleView()}
            >
              Grid
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'navigator' ? 'active' : ''}`}
              onClick={() => viewMode !== 'navigator' && onToggleView()}
            >
              Navigator
            </button>
          </div>

          <button
            className={`view-toggle-btn${showFaces ? ' active' : ''}`}
            onClick={onToggleShowFaces}
          >
            {showFaces ? 'Hide Faces' : 'Show Faces'}
          </button>
        </div>
      </div>

      <div className="viewer-content">
        {viewMode === 'grid'
          ? <PhotoGrid
              photos={photos}
              onSelectPhoto={onSelectPhoto}
              onPageSizeChange={onPageSizeChange}
              showFaces={showFaces}
            />
          : <PhotoNavigator
              photos={photos}
              pagination={pagination}
              onPageChange={onPageChange}
              onSelectPhoto={onSelectPhoto}
              showFaces={showFaces}
            />
        }
      </div>

      {viewMode === 'grid' && pages > 1 && (
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
