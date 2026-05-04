import { isValidGeohash } from 'bitchat-module';

/**
 * Extract a geohash from the raw query: accept "#abc" and bare "abc" as
 * long as it's at least 2 chars and passes `isValidGeohash`. Decline if
 * the query contains whitespace — that's almost certainly a word search,
 * not a geohash, even if every letter happens to be base32.
 */
export function parseGeohashQuery(trimmed: string): string | null {
  if (!trimmed) return null;
  const hash = trimmed.startsWith('#') ? trimmed.slice(1).toLowerCase() : trimmed.toLowerCase();
  if (hash.length < 2) return null;
  if (!isValidGeohash(hash)) return null;
  if (!trimmed.startsWith('#') && /\s/.test(trimmed)) return null;
  return hash;
}
