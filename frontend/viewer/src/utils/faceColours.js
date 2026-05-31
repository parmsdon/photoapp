export const FACE_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#e91e63', '#00bcd4', '#8bc34a',
];

/** Return the colour for a given cluster ID (1-based). */
export function faceColor(clusterId) {
  if (clusterId == null) return '#888888';
  return FACE_COLORS[(clusterId - 1) % FACE_COLORS.length];
}

/**
 * Parse the numeric rank from a person name such as "Person_00003".
 * Returns the integer rank, or null if the name doesn't match the pattern.
 */
export function personRankFromName(name) {
  const match = name?.match(/Person_(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}
