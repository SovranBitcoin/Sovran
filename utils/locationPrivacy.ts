/**
 * Location privacy utility.
 *
 * Generates a random lat/lng offset so the map camera never centres on the
 * user's exact position. The offset is created once per app session (cold
 * start) and reused on every call, so the map doesn't jump between renders.
 *
 * Offset distance: 200 – 800 m in a random direction.
 */

const MIN_DISTANCE_M = 750;
const MAX_DISTANCE_M = 1800;

/** Approximate metres per degree of latitude (constant everywhere on Earth). */
const METERS_PER_DEG_LAT = 111_320;

// Cached per session --------------------------------------------------------

let _offset: { lat: number; lon: number } | null = null;

function ensureOffset(): { lat: number; lon: number } {
  if (_offset) return _offset;

  const angle = Math.random() * 2 * Math.PI;
  const distance = MIN_DISTANCE_M + Math.random() * (MAX_DISTANCE_M - MIN_DISTANCE_M);

  _offset = {
    lat: (distance * Math.cos(angle)) / METERS_PER_DEG_LAT,
    // longitude degrees shrink with latitude – but for a privacy jitter we
    // don't need geodesic precision, so we use the same constant.
    lon: (distance * Math.sin(angle)) / METERS_PER_DEG_LAT,
  };

  return _offset;
}

// Public API ----------------------------------------------------------------

/** Apply the session-stable safety offset to a coordinate pair. */
export function applySafetyOffset(
  lat: number,
  lon: number
): { latitude: number; longitude: number } {
  const o = ensureOffset();
  return { latitude: lat + o.lat, longitude: lon + o.lon };
}
