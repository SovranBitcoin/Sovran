import { normalizeURL } from 'nostr-tools/utils';

/**
 * Canonical WebSocket relay URL normalization without NDK.
 *
 * Accepts only `ws://` and `wss://` URLs (rejects `http:`, `javascript:`, bare
 * non-URL strings, etc.), lowercases scheme and host, strips default ports and
 * fragments, and preserves path trailing slashes (including before `?query`)
 * while keeping NDK's canonical trailing slash on queryless paths so previously
 * saved relay lists stay equal.
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
  const hadTrailingSlash = parsed.pathname.endsWith('/');
  const normalized = normalizeURL(trimmed);
  const out = new URL(normalized);
  if (out.protocol !== 'wss:' && out.protocol !== 'ws:') {
    throw new Error(`Invalid normalized relay URL: ${normalized}`);
  }
  // `normalizeURL` strips trailing slashes on non-root paths. Preserve an
  // explicit trailing slash (so `/a/?x=1` and `/a?x=1` never collapse to the
  // same endpoint) and keep NDK's trailing-slash form for queryless paths.
  if (!out.pathname.endsWith('/') && (hadTrailingSlash || out.search === '')) {
    out.pathname += '/';
  }
  return out.toString();
}

export function tryNormalizeRelayUrl(raw: string): string | null {
  try {
    return normalizeRelayUrl(raw);
  } catch {
    return null;
  }
}
