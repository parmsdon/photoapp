import { useState, useEffect, useRef, useCallback } from 'react';
import './PeopleManager.css';
import { API_BASE } from '../config';
import PersonDetail from './PersonDetail';
import SuggestionReview from './SuggestionReview';

const API = `${API_BASE}/api`;

// Must match PeopleManager.css card dimensions
const CARD_W      = 180;
const CARD_H      = 260;
const GAP         = 10;
const GRID_PAD    = 12;
// Fixed chrome heights subtracted from the outer container so the calculation
// is stable whether or not the pagination bar is currently rendered.
const HEADER_H    = 36;  // .people-header
const PAGINATION_H = 44; // .people-pagination (always reserved)

function calcPageSize(w, h) {
  const gridH = h - HEADER_H - PAGINATION_H;
  const cols = Math.max(1, Math.floor((w - GRID_PAD * 2 + GAP) / (CARD_W + GAP)));
  const rows = Math.max(1, Math.floor((gridH - GRID_PAD * 2 + GAP) / (CARD_H + GAP)));
  return cols * rows;
}

// ── PersonCard ─────────────────────────────────────────────────────────────

function PersonCard({ cluster, isEditing, editName, onEditName, onSaveEdit, onCancelEdit,
                      isMergingSource, isMergeTarget, noActions,
                      onStartEdit, onStartMerge, onSelectTarget, onDeleteRequest,
                      onSuggest, onDrillDown, refreshTrigger }) {
  // Track which photo is currently shown (null = default sample)
  const [currentPhotoId, setCurrentPhotoId] = useState(null);
  const currentPhotoIdRef = useRef(null);
  const isFirstRender = useRef(true);

  currentPhotoIdRef.current = currentPhotoId;

  const cropUrl = currentPhotoId
    ? `${API}/people/clusters/${cluster.id}/face-crop?photo_id=${currentPhotoId}`
    : `${API}/people/clusters/${cluster.id}/face-crop`;

  async function fetchNextSample() {
    const exclude = currentPhotoIdRef.current ?? cluster.sample_photo_id;
    const res = await fetch(
      `${API}/people/clusters/${cluster.id}/next-sample?exclude=${exclude}`
    );
    if (!res.ok) return; // no other photos available
    const { photo_id } = await res.json();
    setCurrentPhotoId(photo_id);
  }

  // Respond to "Refresh All" without triggering on first mount
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    fetchNextSample();
  }, [refreshTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const canCycle = cluster.face_count > 1;

  return (
    <div
      className={[
        'person-card',
        isMergingSource ? 'card-merging-source' : '',
        isMergeTarget   ? 'card-merge-target'   : '',
      ].filter(Boolean).join(' ')}
      data-cluster-id={cluster.id}
      onClick={isMergeTarget ? () => onSelectTarget(cluster)
               : (onDrillDown ? () => onDrillDown(cluster) : undefined)}
    >
      {/* Face crop thumbnail */}
      <div className="card-thumb">
        <img src={cropUrl} alt={cluster.name} loading="lazy" />
        {isMergingSource && <div className="card-source-badge">Source</div>}
        {canCycle && !isMergeTarget && (
          <button
            className="card-cycle-btn"
            title="Show a different face sample"
            onClick={e => { e.stopPropagation(); fetchNextSample(); }}
          >↻</button>
        )}
      </div>

      {/* Card body */}
      <div className="card-body">
        {isEditing ? (
          <>
            <input
              className="card-name-input"
              value={editName}
              onChange={e => onEditName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  onSaveEdit();
                if (e.key === 'Escape') onCancelEdit();
              }}
              autoFocus
              onClick={e => e.stopPropagation()}
            />
            <div className="card-edit-actions">
              <button className="card-action-btn confirm-btn"
                onClick={e => { e.stopPropagation(); onSaveEdit(); }}>✓</button>
              <button className="card-action-btn cancel-btn"
                onClick={e => { e.stopPropagation(); onCancelEdit(); }}>✕</button>
            </div>
          </>
        ) : (
          <div className="card-info-row">
            <span className="card-name" title={cluster.name}>{cluster.name}</span>
            {!noActions && (
              <div className="card-actions">
                <button className="card-action-btn edit-btn" title="Rename"
                  onClick={e => { e.stopPropagation(); onStartEdit(cluster); }}>✏</button>
                <button className="card-action-btn merge-btn" title="Merge into another person"
                  onClick={e => { e.stopPropagation(); onStartMerge(cluster); }}>⇄</button>
                <button className="card-action-btn delete-person-btn" title="Delete this person"
                  onClick={e => { e.stopPropagation(); onDeleteRequest(cluster); }}>🗑</button>
                <button className="card-action-btn suggest-btn" title="Review face suggestions"
                  onClick={e => { e.stopPropagation(); onSuggest(cluster); }}>≈</button>
              </div>
            )}
          </div>
        )}
        <span className="card-face-count">
          {cluster.face_count} photo{cluster.face_count !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

// ── PeopleManager ──────────────────────────────────────────────────────────

export default function PeopleManager({ afterTagOperation }) {
  // ── Navigation ────────────────────────────────────────────────────────────
  const [view, setView]                   = useState('grid'); // 'grid'|'person'
  const [selectedCluster, setSelectedCluster] = useState(null);

  function drillDown(cluster) {
    drillDownPageRef.current = pageRef.current;
    drillDownIdRef.current   = cluster.id;
    setSelectedCluster(cluster);
    setView('person');
  }
  function backToGrid() {
    savedPageRef.current  = drillDownPageRef.current;
    drillDownPageRef.current = null;
    isRestoringPage.current  = true; // prevent ResizeObserver from resetting page
    setView('grid');
    setSelectedCluster(null);
    fetchClusters();
    afterTagOperation();
  }

  // ── Cluster grid state ────────────────────────────────────────────────────
  const [clusters, setClusters]     = useState([]);
  const [page, setPage]             = useState(1);
  const [pageSize, setPageSize]     = useState(12);
  const [editingId, setEditingId]   = useState(null);
  const [editName, setEditName]     = useState('');
  const [mergingId, setMergingId]   = useState(null);
  const [pendingMerge, setPendingMerge]       = useState(null);
  const [pendingDelete, setPendingDelete]     = useState(null);
  const [reviewingCluster, setReviewingCluster] = useState(null); // for SuggestionReview overlay
  const [refreshAllTrigger, setRefreshAllTrigger] = useState(0);

  const containerRef     = useRef(null); // observe outer container, not the grid
  const lastSizeRef      = useRef(0);
  const debounceRef      = useRef(null);
  const savedPageRef     = useRef(null); // used by rename to preserve page
  const drillDownPageRef = useRef(null); // used by drill-down back navigation
  const drillDownIdRef   = useRef(null); // cluster id to scroll into view on return
  const pageRef            = useRef(page);    // synchronously in sync via updatePage()
  const mergeSourcePageRef = useRef(null);    // page when merge was initiated
  const pageSizeRef        = useRef(12);      // synchronously in sync via updatePageSize()
  const isRestoringPage    = useRef(false);   // blocks ResizeObserver page-reset during restoration

  // ── Data ─────────────────────────────────────────────────────────────────

  const fetchClusters = useCallback(() => {
    fetch(`${API}/people/clusters`)
      .then(r => r.json())
      .then(data => {
        setClusters(data);
        updatePage(savedPageRef.current ?? 1);
        savedPageRef.current    = null;
        isRestoringPage.current = false; // restoration complete
      })
      .catch(console.error);
  }, []);

  // Helpers that keep refs synchronously in sync — use instead of raw setPage/setPageSize
  function updatePage(n)     { pageRef.current = n;     setPage(n); }
  function updatePageSize(n) { pageSizeRef.current = n; setPageSize(n); }

  useEffect(() => { fetchClusters(); }, [fetchClusters]);

  // After returning to grid, scroll the previously-viewed card into view
  useEffect(() => {
    if (view !== 'grid' || !drillDownIdRef.current) return;
    const id = drillDownIdRef.current;
    const timer = setTimeout(() => {
      const card = document.querySelector(`[data-cluster-id="${id}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      drillDownIdRef.current = null;
    }, 50);
    return () => clearTimeout(timer);
  }, [view, clusters]);

  // ── ResizeObserver ────────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      // Skip measurements taken during transitional states (container collapsing)
      if (width < 200 || height < 200) return;
      const newSize = calcPageSize(width, height);
      if (newSize === lastSizeRef.current) return;
      lastSizeRef.current = newSize;
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const sizeChanged = newSize !== pageSizeRef.current;
        updatePageSize(newSize);
        if (!isRestoringPage.current && sizeChanged) updatePage(1);
      }, 150);
    });
    observer.observe(el);
    return () => { observer.disconnect(); clearTimeout(debounceRef.current); };
  }, []);

  // ── Rename ────────────────────────────────────────────────────────────────

  function startEdit(cluster) { setEditingId(cluster.id); setEditName(cluster.name); }
  function cancelEdit()       { setEditingId(null); setEditName(''); }

  async function saveEdit() {
    const trimmed = editName.trim();
    if (!trimmed) { cancelEdit(); return; }
    savedPageRef.current = page; // preserve page before fetch resets it
    await fetch(`${API}/people/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cluster_id: editingId, new_name: trimmed }),
    });
    cancelEdit();
    fetchClusters();
    afterTagOperation();
  }

  // ── Merge ─────────────────────────────────────────────────────────────────

  async function confirmDelete() {
    // If this was the last card on the current page, step back to avoid an empty page
    savedPageRef.current = visibleClusters.length <= 1 ? Math.max(1, page - 1) : page;
    await fetch(`${API}/people/clusters/${pendingDelete.id}`, { method: 'DELETE' });
    setPendingDelete(null);
    fetchClusters();
    afterTagOperation();
  }

  function startMerge(cluster) {
    mergeSourcePageRef.current = pageRef.current; // remember the page the source was on
    setMergingId(cluster.id);
    setPendingMerge(null);
  }
  function cancelMerge() { setMergingId(null); setPendingMerge(null); }

  function selectTarget(target) {
    if (target.id === mergingId) return;
    setPendingMerge({ source: clusters.find(c => c.id === mergingId), target });
  }

  async function confirmMerge() {
    // Return to the page the source cluster was on (captured at merge start, not at confirm time)
    savedPageRef.current = mergeSourcePageRef.current ?? 1;
    await fetch(`${API}/people/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_cluster_id: pendingMerge.source.id,
        target_cluster_id: pendingMerge.target.id,
      }),
    });
    cancelMerge();
    fetchClusters();
    afterTagOperation();
  }

  // ── Pagination ────────────────────────────────────────────────────────────

  const pages           = Math.max(1, Math.ceil(clusters.length / pageSize));
  const visibleClusters = clusters.slice((page - 1) * pageSize, page * pageSize);
  const mergingCluster  = clusters.find(c => c.id === mergingId);

  // ── Render ────────────────────────────────────────────────────────────────

  if (view === 'person' && selectedCluster) {
    return <PersonDetail cluster={selectedCluster} onBack={backToGrid} afterTagOperation={afterTagOperation} />;
  }
  return (
    <div className="people-manager" ref={containerRef}>
      <div className="people-header">
        <span className="people-title">People</span>
        <span className="people-count">
          {clusters.length} person{clusters.length !== 1 ? 's' : ''}
        </span>
        <button
          className="people-refresh-all-btn"
          title="Cycle all visible cards to a new sample"
          onClick={() => setRefreshAllTrigger(n => n + 1)}
        >↻ Refresh All</button>
      </div>

      {mergingId && !pendingMerge && (
        <div className="merge-banner">
          <span>Click a person to merge <strong>{mergingCluster?.name}</strong> into them</span>
          <button className="merge-banner-cancel" onClick={cancelMerge}>Cancel</button>
        </div>
      )}

      {clusters.length === 0 ? (
        <div className="people-empty">
          No person clusters found. Run face_detector.py and face_clusterer.py first.
        </div>
      ) : (
        <div className="people-grid">
          {visibleClusters.map(cluster => (
            <PersonCard
              key={cluster.id}
              cluster={cluster}
              isEditing={editingId === cluster.id}
              editName={editName}
              onEditName={setEditName}
              onSaveEdit={saveEdit}
              onCancelEdit={cancelEdit}
              isMergingSource={mergingId === cluster.id}
              isMergeTarget={mergingId !== null && mergingId !== cluster.id}
              refreshTrigger={refreshAllTrigger}
              noActions={mergingId !== null && mergingId !== cluster.id}
              onStartEdit={startEdit}
              onStartMerge={startMerge}
              onSelectTarget={selectTarget}
              onDeleteRequest={setPendingDelete}
              onSuggest={setReviewingCluster}
              onDrillDown={mergingId ? undefined : drillDown}
            />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="people-pagination">
          <button className="pp-btn" disabled={page <= 1} onClick={() => updatePage(pageRef.current - 1)}>← Prev</button>
          <span className="pp-info">Page {page} of {pages}</span>
          <button className="pp-btn" disabled={page >= pages} onClick={() => updatePage(pageRef.current + 1)}>Next →</button>
        </div>
      )}

      {pendingMerge && (
        <div className="merge-overlay" onClick={cancelMerge}>
          <div className="merge-confirm" onClick={e => e.stopPropagation()}>
            <p className="merge-confirm-title">Merge people?</p>
            <p className="merge-confirm-msg">
              Merge <strong>{pendingMerge.source.name}</strong> into{' '}
              <strong>{pendingMerge.target.name}</strong>?
              <br />
              {pendingMerge.source.face_count} face{pendingMerge.source.face_count !== 1 ? 's' : ''} will be
              reassigned. This cannot be undone.
            </p>
            <div className="merge-confirm-actions">
              <button className="dc-btn dc-cancel" onClick={cancelMerge}>Cancel</button>
              <button className="dc-btn dc-merge" onClick={confirmMerge}>Merge</button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="merge-overlay" onClick={() => setPendingDelete(null)}>
          <div className="merge-confirm" onClick={e => e.stopPropagation()}>
            <p className="merge-confirm-title">Delete person?</p>
            <p className="merge-confirm-msg">
              Delete <strong>{pendingDelete.name}</strong>? Their faces will become unidentified.
              This cannot be undone.
            </p>
            <div className="merge-confirm-actions">
              <button className="dc-btn dc-cancel" onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="dc-btn dc-delete-person" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {reviewingCluster && (
        <SuggestionReview
          cluster={reviewingCluster}
          onClose={() => setReviewingCluster(null)}
          afterTagOperation={afterTagOperation}
        />
      )}
    </div>
  );
}
