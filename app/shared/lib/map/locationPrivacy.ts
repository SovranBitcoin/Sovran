/**
 * Location privacy utility.
 *
 * Generates a random lat/lng offset so the map camera never centres on the
 * user's exact position. The offset is created once per app session (cold
 * start) and reused on every call, so the map doesn't jump between renders.
 *
 * Offset distance: 750 – 1 800 m in a random direction.
 */

const MIN_DISTANCE_M = 750;
const MAX_DISTANCE_M = 1800;

const EARTH_RADIUS_M = 6_371_000;

// Cached per session --------------------------------------------------------

let _offset: { bearing: number; distance: number } | null = null;

function ensureOffset(): { bearing: number; distance: number } {
  if (_offset) return _offset;

  const random = crypto.getRandomValues(new Uint32Array(2));
  _offset = {
    bearing: (random[0] / 2 ** 32) * 2 * Math.PI,
    distance: MIN_DISTANCE_M + (random[1] / 2 ** 32) * (MAX_DISTANCE_M - MIN_DISTANCE_M),
  };

  return _offset;
}

// Public API ----------------------------------------------------------------

/** Apply the session-stable safety offset to a coordinate pair. */
export function applySafetyOffset(
  lat: number,
  lon: number
): { latitude: number; longitude: number } {
  const { bearing, distance } = ensureOffset();
  const latitude = (lat * Math.PI) / 180;
  const longitude = (lon * Math.PI) / 180;
  const angularDistance = distance / EARTH_RADIUS_M;
  const safeLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const safeLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(safeLatitude)
    );

  return {
    latitude: (safeLatitude * 180) / Math.PI,
    longitude: (((safeLongitude * 180) / Math.PI + 540) % 360) - 180,
  };
}
