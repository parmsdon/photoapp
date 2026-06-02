import { useState, useEffect, useRef, useCallback } from 'react';
import './SuggestionReview.css';
import { API_BASE } from '../config';

const API = `${API_BASE}/api`;

const FACE_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#e91e63', '#00bcd4', '#8bc34a',
];
function faceColor(clusterId) {
  if (!clusterId) return '#FFD700';
  return FACE_COLORS[(clusterId - 1) % FACE_COLORS.length];
}

function gapLabel(gap) {
  const pct = (gap * 100).toFixed(1);
  return gap < 0 ? `${pct}% (closer to suggestion)` : `Gap: ${pct}%`;
}

export default function SuggestionReview({ cluster, onClose, afterTagOperation }) {
  const [threshold, setThreshold] = useState(0.15);
  const [suggestions, setSuggestions] = useState([]); // face-level entries
  const [currentIndex, setCurrentIndex] = useState(0);
  const [computing, setComputing] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [computed, setComputed]   = useState(false);

  // ── Lightbox ──────────────────────────────────────────────────────────────
  const [lightboxOpen, setLightboxOpen]       = useState(false);
  const [lightboxFaces, setLightboxFaces]     = useState([]);
  const [lightboxBoxes, setLightboxBoxes]     = useState([]);
  const [lbImgSize, setLbImgSize]             = useState({ w: 0, h: 0 });
  const lbImgRef = useRef(null);

  const fetchSuggestions = useCallback((thresh) => {
    setLoading(true);
    fetch(`${API}/people/suggestions?cluster_id=${cluster.id}&max_gap=${thresh}`)
      .then(r => r.json())
      .then(data => { setSuggestions(data); setCurrentIndex(0); setLoading(false); })
      .catch(() => setLoading(false));
  }, [cluster.id]);

  async function handleCompute() {
    setComputing(true);
    await fetch(`${API}/people/suggestions/compute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cluster_id: cluster.id, max_gap: threshold }),
    });
    setComputed(true);
    setComputing(false);
    fetchSuggestions(threshold);
  }

  // ── Lightbox handlers ─────────────────────────────────────────────────────

  function openLightbox() {
    if (!current) return;
    setLightboxOpen(true);
    setLbImgSize({ w: 0, h: 0 });
    fetch(`${API_BASE}/api/photos/${current.photo_id}/faces`)
      .then(r => r.json())
      .then(setLightboxFaces)
      .catch(() => setLightboxFaces([]));
  }

  function closeLightbox() {
    setLightboxOpen(false);
    setLightboxBoxes([]);
  }

  function handleLbImgLoad() {
    const img = lbImgRef.current;
    if (img) setLbImgSize({ w: img.clientWidth, h: img.clientHeight });
  }

  // Scale face bboxes to rendered image dimensions
  useEffect(() => {
    if (!lbImgSize.w || !lightboxFaces.length) { setLightboxBoxes([]); return; }
    const iw = lightboxFaces[0]?.image_width;
    if (!iw) { setLightboxBoxes([]); return; }
    const sx = lbImgSize.w / iw;
    const sy = lbImgSize.h / lightboxFaces[0].image_height;
    setLightboxBoxes(lightboxFaces.map(f => ({
      id: f.id, cluster_id: f.cluster_id, person_name: f.person_name,
      x: f.bbox.left * sx, y: f.bbox.top * sy,
      w: (f.bbox.right - f.bbox.left) * sx,
      h: (f.bbox.bottom - f.bbox.top) * sy,
    })));
  }, [lbImgSize, lightboxFaces]);

  // Escape key closes lightbox
  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = e => { if (e.key === 'Escape') closeLightbox(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxOpen]);

  // Close lightbox when the current suggestion changes
  useEffect(() => { setLightboxOpen(false); }, [currentIndex]);

  // ── Accept one specific alternative — backend marks all siblings reviewed
  async function handleChange(suggestionId) {
    await fetch(`${API}/people/suggestions/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestion_id: suggestionId }),
    });
    afterTagOperation();
    setCurrentIndex(i => i + 1);
  }

  async function handleSkip() {
    // Skip without reviewing — just advance
    setCurrentIndex(i => i + 1);
  }

  const current = suggestions[currentIndex];
  const allDone = computed && !loading && currentIndex >= suggestions.length;

  return (
    <>
    <div className="sr-overlay" onClick={onClose}>
      <div className="sr-modal" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="sr-header">
          <span className="sr-title">
            <strong>{cluster.name}</strong>
            {computed && !loading && (
              <span className="sr-subtitle">
                {suggestions.length === 0
                  ? ' — no suggestions'
                  : (() => {
                      const distinctPhotos = new Set(suggestions.map(s => s.photo_id)).size;
                      return ` — ${suggestions.length} face detection${suggestions.length !== 1 ? 's' : ''} to review (across ${distinctPhotos} photo${distinctPhotos !== 1 ? 's' : ''})`;
                    })()}
              </span>
            )}
          </span>
          <button className="sr-close-x" onClick={onClose}>✕</button>
        </div>

        {/* ── Controls ── */}
        <div className="sr-controls">
          <label className="sr-label">Strictness</label>
          <div className="sr-slider-wrap">
            <input type="range" className="sr-slider"
              min="0.05" max="0.30" step="0.01"
              value={threshold}
              onChange={e => setThreshold(parseFloat(e.target.value))}
            />
            <span className="sr-slider-hint">
              Low = fewer, high confidence &nbsp;|&nbsp; High = more, lower confidence
            </span>
          </div>
          <span className="sr-thresh-val">{Math.round(threshold * 100)}%</span>
          <button className="sr-compute-btn" onClick={handleCompute} disabled={computing || loading}>
            {computing ? 'Computing…' : 'Compute'}
          </button>
        </div>

        {/* ── State messages ── */}
        {!computed && !computing && (
          <div className="sr-state">Set strictness and click Compute.</div>
        )}
        {(computing || loading) && (
          <div className="sr-state">{computing ? 'Computing face clusters…' : 'Loading suggestions…'}</div>
        )}
        {allDone && suggestions.length === 0 && (
          <div className="sr-state">No suggestions — all faces look well-matched.</div>
        )}
        {allDone && suggestions.length > 0 && (
          <div className="sr-complete">
            <p>All {suggestions.length} face{suggestions.length !== 1 ? 's' : ''} reviewed!</p>
            <button className="sr-done-btn" onClick={onClose}>Done</button>
          </div>
        )}

        {/* ── Three-column comparison ── */}
        {current && (
          <>
            <div className="sr-panels">

              {/* Left — current person */}
              <div className="sr-col sr-col-current">
                <div className="sr-col-label">Currently</div>
                <div className="sr-crop sr-crop-main">
                  <img src={`${API_BASE}${current.current_sample_crop_url}`} alt="current" />
                </div>
                <div className="sr-person-name">{current.current_cluster_name}</div>
              </div>

              {/* Centre — ambiguous face + skip */}
              <div className="sr-col sr-col-face">
                <div className="sr-col-label">Ambiguous face</div>
                <div className="sr-crop sr-crop-face sr-crop-clickable" onClick={openLightbox}
                  title="Click to see full photo">
                  <img src={`${API_BASE}${current.face_crop_url}`} alt="face" />
                </div>
                <span className="sr-face-hint">click to see full photo</span>
                <div className={`sr-gap-label${current.alternatives[0]?.confidence_gap < 0 ? ' sr-gap-strong' : ''}`}>
                  {gapLabel(current.alternatives[0]?.confidence_gap ?? 0)}
                </div>
                <button className="sr-skip-btn" onClick={handleSkip}>Skip →</button>
              </div>

              {/* Right — alternatives (1–3) */}
              <div className="sr-col sr-col-alts">
                <div className="sr-col-label">Suggestions</div>
                <div className="sr-alts">
                  {current.alternatives.map(alt => (
                    <div key={alt.suggestion_id} className="sr-alt">
                      <div className="sr-alt-crop">
                        <img src={`${API_BASE}${alt.sample_crop_url}`} alt={alt.cluster_name} />
                      </div>
                      <div className="sr-alt-info">
                        <span className="sr-alt-name">{alt.cluster_name}</span>
                        <span className={`sr-alt-gap${alt.confidence_gap < 0 ? ' sr-gap-strong' : ''}`}>
                          {gapLabel(alt.confidence_gap)}
                        </span>
                        <button className="sr-change-btn" onClick={() => handleChange(alt.suggestion_id)}>
                          Change →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="sr-footer">
              <span className="sr-progress">{currentIndex + 1} of {suggestions.length}</span>
            </div>
          </>
        )}
      </div>
    </div>

    {/* ── Lightbox — above the modal ── */}
    {lightboxOpen && current && (
      <div className="sr-lightbox-overlay" onClick={closeLightbox}>
        <button className="sr-lightbox-close" onClick={e => { e.stopPropagation(); closeLightbox(); }}>✕</button>
        <div
          className="sr-lightbox-wrapper"
          style={lbImgSize.w ? { width: lbImgSize.w, height: lbImgSize.h } : {}}
          onClick={e => e.stopPropagation()}
        >
          <img
            ref={lbImgRef}
            className="sr-lightbox-img"
            src={`${API_BASE}/api/photos/full/${current.photo_id}`}
            alt="Full photo"
            onLoad={handleLbImgLoad}
          />
          {lightboxBoxes.map(face => {
            const color = faceColor(face.cluster_id);
            return (
              <div key={face.id} className="sr-lb-face-box"
                style={{ left: face.x, top: face.y, width: face.w, height: face.h, borderColor: color }}>
                <span className="sr-lb-face-label" style={{ background: color }}>
                  {face.person_name || '?'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    )}
    </>
  );
}
