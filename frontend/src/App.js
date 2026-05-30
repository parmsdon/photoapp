import { useState, useEffect } from "react";

const API = "/api";

function App() {
  const [photos, setPhotos] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchTags();
  }, []);

  useEffect(() => {
    fetchPhotos(selectedTag);
  }, [selectedTag]);

  async function fetchPhotos(tag) {
    setLoading(true);
    setError(null);
    try {
      const url = tag ? `${API}/photos?tag=${encodeURIComponent(tag)}` : `${API}/photos`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPhotos(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchTags() {
    try {
      const res = await fetch(`${API}/tags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTags(await res.json());
    } catch (err) {
      console.error("Failed to load tags:", err);
    }
  }

  async function deletePhoto(id) {
    await fetch(`${API}/photos/${id}`, { method: "DELETE" });
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.title}>PhotoApp</h1>
      </header>

      <div style={styles.layout}>
        <aside style={styles.sidebar}>
          <h2 style={styles.sidebarTitle}>Filter by Tag</h2>
          <ul style={styles.tagList}>
            <li
              style={selectedTag === null ? { ...styles.tagItem, ...styles.tagItemActive } : styles.tagItem}
              onClick={() => setSelectedTag(null)}
            >
              All Photos
            </li>
            {tags.map((tag) => (
              <li
                key={tag.id}
                style={selectedTag === tag.name ? { ...styles.tagItem, ...styles.tagItemActive } : styles.tagItem}
                onClick={() => setSelectedTag(tag.name)}
              >
                <span style={styles.tagBadge(tag.tag_type)}>{tag.tag_type}</span>
                {tag.name}
              </li>
            ))}
          </ul>
        </aside>

        <main style={styles.main}>
          {loading && <p>Loading photos...</p>}
          {error && <p style={styles.error}>Error: {error}</p>}
          {!loading && !error && photos.length === 0 && (
            <p style={styles.empty}>No photos found. Import photos to get started.</p>
          )}
          <div style={styles.grid}>
            {photos.map((photo) => (
              <PhotoCard key={photo.id} photo={photo} onDelete={deletePhoto} />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

function PhotoCard({ photo, onDelete }) {
  return (
    <div style={styles.card}>
      <img
        src={`/api/photos/${photo.id}/file`}
        alt={photo.filename}
        style={styles.cardImage}
        loading="lazy"
      />
      <div style={styles.cardBody}>
        <p style={styles.cardFilename}>{photo.filename}</p>
        {photo.date_taken && (
          <p style={styles.cardMeta}>{new Date(photo.date_taken).toLocaleDateString()}</p>
        )}
        <div style={styles.cardTags}>
          {photo.tags.map((tag) => (
            <span key={tag.id} style={styles.tagBadge(tag.tag_type)}>
              {tag.name}
            </span>
          ))}
        </div>
        <button style={styles.deleteBtn} onClick={() => onDelete(photo.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}

const TAG_COLORS = {
  source: "#4a90d9",
  metadata: "#7b68ee",
  face: "#e67e22",
  user: "#27ae60",
};

const styles = {
  app: { fontFamily: "system-ui, sans-serif", minHeight: "100vh", background: "#f5f5f5" },
  header: { background: "#1a1a2e", color: "#fff", padding: "1rem 2rem" },
  title: { margin: 0, fontSize: "1.5rem" },
  layout: { display: "flex", gap: "1rem", padding: "1rem 2rem" },
  sidebar: { width: 220, flexShrink: 0 },
  sidebarTitle: { fontSize: "0.9rem", textTransform: "uppercase", color: "#666", marginBottom: "0.5rem" },
  tagList: { listStyle: "none", padding: 0, margin: 0 },
  tagItem: {
    padding: "0.5rem 0.75rem",
    borderRadius: 6,
    cursor: "pointer",
    marginBottom: 4,
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: "0.9rem",
  },
  tagItemActive: { background: "#1a1a2e", color: "#fff" },
  main: { flex: 1 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem" },
  card: { background: "#fff", borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.1)" },
  cardImage: { width: "100%", height: 160, objectFit: "cover", display: "block", background: "#ddd" },
  cardBody: { padding: "0.75rem" },
  cardFilename: { margin: "0 0 0.25rem", fontSize: "0.8rem", color: "#333", wordBreak: "break-all" },
  cardMeta: { margin: "0 0 0.5rem", fontSize: "0.75rem", color: "#888" },
  cardTags: { display: "flex", flexWrap: "wrap", gap: 4, marginBottom: "0.5rem" },
  deleteBtn: {
    background: "#e74c3c",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "0.25rem 0.5rem",
    cursor: "pointer",
    fontSize: "0.75rem",
  },
  error: { color: "#e74c3c" },
  empty: { color: "#888", fontStyle: "italic" },
  tagBadge: (type) => ({
    fontSize: "0.7rem",
    padding: "1px 6px",
    borderRadius: 10,
    background: TAG_COLORS[type] || "#999",
    color: "#fff",
    whiteSpace: "nowrap",
  }),
};

export default App;
