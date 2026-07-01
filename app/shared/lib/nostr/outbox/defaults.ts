/**
 * @fileoverview Default (bootstrap) relay set + url normalization.
 *
 * Used when a profile has no NIP-65 `kind:10002` relay list yet: writes fall
 * back to these, and a fresh derived profile auto-publishes them as its initial
 * relay list so followers can find it. Curated for write-reliability from the
 * sets shipped by Damus and Amethyst (verified in their repos). Nagg is a
 * read-side app-view, never a write/bootstrap relay, so it is deliberately
 * absent here.
 */
import { normalizeRelayUrl } from '@nostr-dev-kit/ndk-mobile';

/** Opinionated, write-capable bootstrap relays. Order is not significant. */
export const DEFAULT_RELAYS: readonly string[] = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.nostr.band',
];

/** Hard cap on a publish fan-out, so mention routing can't balloon. */
export const MAX_WRITE_RELAYS = 8;

/**
 * Normalizes a relay url via NDK (lowercases host, applies canonical trailing
 * slash). Returns null for unparseable input so callers can drop it.
 */
export function safeNormalizeRelay(url: string): string | null {
  try {
    return normalizeRelayUrl(url);
  } catch {
    return null;
  }
}

/** Normalizes + dedupes a list of relay urls, dropping unparseable entries. */
export function normalizeRelayList(urls: readonly string[]): string[] {
  const out = new Set<string>();
  for (const url of urls) {
    const normalized = safeNormalizeRelay(url);
    if (normalized) out.add(normalized);
  }
  return [...out];
}
