const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(
  latitude: number,
  longitude: number,
  precision: number
): string {
  if (precision <= 0) return '';

  let latMin = -90,
    latMax = 90;
  let lonMin = -180,
    lonMax = 180;
  let isLon = true;
  let bit = 0;
  let charIndex = 0;
  let hash = '';

  const lat = Math.max(-90, Math.min(90, latitude));
  const lon = Math.max(-180, Math.min(180, longitude));

  while (hash.length < precision) {
    const mid = isLon ? (lonMin + lonMax) / 2 : (latMin + latMax) / 2;
    const val = isLon ? lon : lat;

    if (val >= mid) {
      charIndex = charIndex * 2 + 1;
      if (isLon) lonMin = mid;
      else latMin = mid;
    } else {
      charIndex = charIndex * 2;
      if (isLon) lonMax = mid;
      else latMax = mid;
    }

    isLon = !isLon;
    bit++;

    if (bit === 5) {
      hash += BASE32[charIndex];
      bit = 0;
      charIndex = 0;
    }
  }

  return hash;
}

export function decodeGeohash(hash: string): { lat: number; lon: number } {
  let latMin = -90,
    latMax = 90;
  let lonMin = -180,
    lonMax = 180;
  let isLon = true;

  for (const char of hash.toLowerCase()) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) break;

    for (let bit = 4; bit >= 0; bit--) {
      const mid = isLon ? (lonMin + lonMax) / 2 : (latMin + latMax) / 2;
      if ((idx >> bit) & 1) {
        if (isLon) lonMin = mid;
        else latMin = mid;
      } else {
        if (isLon) lonMax = mid;
        else latMax = mid;
      }
      isLon = !isLon;
    }
  }

  return {
    lat: (latMin + latMax) / 2,
    lon: (lonMin + lonMax) / 2,
  };
}

const VALID_GEOHASH_RE = /^[0-9b-df-hj-np-z]+$/;

export function isValidGeohash(hash: string): boolean {
  return hash.length > 0 && hash.length <= 12 && VALID_GEOHASH_RE.test(hash.toLowerCase());
}
