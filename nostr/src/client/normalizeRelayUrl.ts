import { normalizeURL } from 'nostr-tools/utils';

/**
 * Canonical WebSocket relay URL normalization without NDK.
 *
 * Accepts only `ws://` and `wss://` URLs (rejects `http:`, `javascript:`, bare
 * non-URL strings, etc.), lowercases scheme and host, strips default ports and
 * fragments, and ends every path with a canonical trailing slash, matching the
 * NDK-normalized relay lists earlier releases saved.
 */
export function normalizeRelayUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!/^wss?:\/\//i.test(trimmed)) {
    throw new Error(`Invalid relay URL scheme: ${trimmed}`);
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') {
    throw new Error(`Invalid relay URL protocol: ${parsed.protocol}`);
  }
  // `normalizeURL` drops a path's trailing slash; relay lists saved under NDK
  // kept it (`wss://nostr.wine/inbox/`), so keep that form for equality.
  let normalized = normalizeURL(trimmed);
  if (!normalized.endsWith('/') && !normalized.includes('?')) normalized += '/';
  const check = new URL(normalized);
  if (check.protocol !== 'wss:' && check.protocol !== 'ws:') {
    throw new Error(`Invalid normalized relay URL: ${normalized}`);
  }
  return normalized;
}

export function tryNormalizeRelayUrl(raw: string): string | null {
  try {
    return normalizeRelayUrl(raw);
  } catch {
    return null;
  }
}
