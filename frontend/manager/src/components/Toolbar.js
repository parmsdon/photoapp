import './Toolbar.css';

export default function Toolbar({
  selectedCount, totalCount,
  onSelectAll, onDeselectAll,
  onAssignTag, onRemoveTag, onArchive,
  showArchived, onToggleShowArchived,
  page, pages, onPageChange,
}) {
  const hasSelection = selectedCount > 0;

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <button className="tb-btn" onClick={onSelectAll}>Select All</button>
        <button className="tb-btn" onClick={onDeselectAll} disabled={!hasSelection}>Deselect All</button>
        <span className="tb-count">
          {hasSelection
            ? <><strong>{selectedCount.toLocaleString()}</strong> selected</>
            : <span className="tb-count-muted">{totalCount.toLocaleString()} photos</span>
          }
        </span>
      </div>

      <div className="toolbar-center">
        {pages > 1 && (
          <>
            <button className="tb-btn" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>← Prev</button>
            <span className="tb-page">Page {page} of {pages}</span>
            <button className="tb-btn" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>Next →</button>
          </>
        )}
      </div>

      <div className="toolbar-right">
        <button className="tb-btn tb-btn-action" disabled={!hasSelection} onClick={onAssignTag}>
          Assign Tag
        </button>
        <button className="tb-btn tb-btn-action" disabled={!hasSelection} onClick={onRemoveTag}>
          Remove Tag
        </button>
        <button className="tb-btn tb-btn-archive" disabled={!hasSelection} onClick={onArchive}
          title="Move selected photos to the archive">
          Archive
        </button>
        <span className="tb-divider" />
        <button
          className={`tb-btn${showArchived ? ' tb-btn-archive-active' : ' tb-btn-secondary'}`}
          onClick={onToggleShowArchived}
        >
          {showArchived ? 'Showing Archived' : 'Show Archived'}
        </button>
      </div>
    </div>
  );
}
