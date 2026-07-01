/**
 * @fileoverview NIP-65 (`kind:10002`) relay-list parse/serialize.
 *
 * A relay list is a set of `["r", <url>, <"read"|"write">?]` tags. A bare `r`
 * tag (no marker) means the relay is used for both reading and writing.
 *
 * Pure functions over plain tag arrays — no NDK, no React — so they unit-test
 * without a network or signer.
 */
import { safeNormalizeRelay } from '@/shared/lib/nostr/outbox/defaults';

/** NIP-65 relay-list metadata event kind. */
export const RELAY_LIST_KIND = 10002;

export interface RelayListEntry {
  /** Normalized relay url. */
  url: string;
  read: boolean;
  write: boolean;
}

/** Minimal event shape this module reads (tags only). */
interface RelayListEventLike {
  tags?: unknown;
  created_at?: number;
}

function normalizeTags(input: unknown): string[][] {
  if (!Array.isArray(input)) return [];
  return input.filter((t): t is string[] => Array.isArray(t) && typeof t[0] === 'string');
}

/**
 * Parses a `kind:10002` event into deduped relay entries. Later tags for the
 * same url win (last-writer-wins within one event). Unparseable urls drop.
 */
export function parseRelayList(event: RelayListEventLike): RelayListEntry[] {
  const byUrl = new Map<string, RelayListEntry>();
  for (const tag of normalizeTags(event.tags)) {
    if (tag[0] !== 'r' || typeof tag[1] !== 'string') continue;
    const url = safeNormalizeRelay(tag[1]);
    if (!url) continue;
    const marker = tag[2];
    const read = marker === undefined || marker === '' || marker === 'read';
    const write = marker === undefined || marker === '' || marker === 'write';
    byUrl.set(url, { url, read, write });
  }
  return [...byUrl.values()];
}

/** Builds the `r`-tags for a `kind:10002` event from relay entries. */
export function serializeRelayList(entries: readonly RelayListEntry[]): string[][] {
  const tags: string[][] = [];
  for (const entry of entries) {
    if (!entry.read && !entry.write) continue; // a relay that is neither is dropped
    if (entry.read && entry.write) {
      tags.push(['r', entry.url]);
    } else {
      tags.push(['r', entry.url, entry.write ? 'write' : 'read']);
    }
  }
  return tags;
}

/** Read-relay urls from a parsed list (for outbox routing to a recipient). */
export function readRelays(entries: readonly RelayListEntry[]): string[] {
  return entries.filter((e) => e.read).map((e) => e.url);
}

/** Write-relay urls from a parsed list (the author's own outbox). */
export function writeRelays(entries: readonly RelayListEntry[]): string[] {
  return entries.filter((e) => e.write).map((e) => e.url);
}
