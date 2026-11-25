import { normalizeURL } from 'nostr-tools/utils';

/**
 * Canonical WebSocket relay URL normalization without NDK.
 *
 * Accepts only `ws://` and `wss://` URLs (rejects `http:`, `javascript:`, bare
 * non-URL strings, etc.), lowercases scheme and host, strips default ports and
 * fragments, and normalizes root URLs with a canonical trailing slash matching
 * `nostr-tools`'s `normalizeURL` and prior persisted relay lists.
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
  const normalized = normalizeURL(trimmed);
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
