/**
 * @fileoverview NIP-17 (`kind:10050`) DM relay-list parse.
 *
 * A DM relay list is a set of `["relay", <url>]` tags naming where its author
 * reads gift-wrapped direct messages. It is deliberately *not* NIP-65: a
 * `kind:10002` list says where someone publishes and reads public notes, and a
 * missing one falls back to bootstrap relays (see `outbox/defaults.ts`). A
 * missing `kind:10050` means the opposite — the user is not ready to receive
 * direct messages, and nothing should be sent. `readDmRelays` returning `[]` is
 * therefore a refusal, never an invitation to guess.
 *
 * Pure functions over plain tag arrays — no NDK, no network — so they unit-test
 * without either.
 *
 * Urls are normalized with nostr-tools rather than the NDK-backed
 * `safeNormalizeRelay` its NIP-65 sibling uses, because these go straight to a
 * nostr-tools `SimplePool` (see `dmRelayDiscovery.ts`). Same reason the other
 * way round for `nip65.ts`: normalize with the stack that consumes the url.
 */
import { normalizeURL } from 'nostr-tools/utils';

/**
 * Normalizes a relay url, returning null for anything we should not hand to a
 * pool. `normalizeURL` is lenient by design — it coerces a schemeless host to
 * `wss://` and maps `http(s)` to `ws(s)`, which is what relay lists in the wild
 * look like — but it only throws on input it cannot parse at all. The scheme
 * check is ours: a `relay` tag is attacker-supplied, and a gift wrap must never
 * be addressed at a non-websocket url.
 */
function safeNormalizeRelay(url: string): string | null {
  try {
    const normalized = normalizeURL(url);
    const { protocol } = new URL(normalized);
    return protocol === 'wss:' || protocol === 'ws:' ? normalized : null;
  } catch {
    return null;
  }
}

/** NIP-17 DM relay-list event kind. */
export const DM_RELAY_LIST_KIND = 10050;

/**
 * NIP-17 asks authors to keep this list small (it suggests 3) so a gift wrap
 * fans out narrowly. We cap what we *read* as well, so a hostile or bloated
 * list can't turn one DM into a broadcast.
 */
export const MAX_DM_RELAYS = 4;

/** Minimal event shape this module reads (tags only). */
interface DmRelayListEventLike {
  tags?: unknown;
}

function normalizeTags(input: unknown): string[][] {
  if (!Array.isArray(input)) return [];
  return input.filter((t): t is string[] => Array.isArray(t) && typeof t[0] === 'string');
}

/**
 * Parses a `kind:10050` event into the relay urls its author reads DMs on.
 * Deduped, normalized, unparseable urls dropped, capped at {@link MAX_DM_RELAYS}.
 *
 * Returns `[]` for a missing, empty or entirely unparseable list — the caller
 * must treat that as "do not send", not as "use defaults".
 */
export function readDmRelays(event: DmRelayListEventLike | null | undefined): string[] {
  if (!event) return [];
  const urls = new Set<string>();
  for (const tag of normalizeTags(event.tags)) {
    if (tag[0] !== 'relay' || typeof tag[1] !== 'string') continue;
    const url = safeNormalizeRelay(tag[1]);
    if (!url) continue;
    urls.add(url);
    if (urls.size >= MAX_DM_RELAYS) break;
  }
  return [...urls];
}

/** Builds the `relay`-tags for a `kind:10050` event. */
export function serializeDmRelayList(urls: readonly string[]): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const normalized = safeNormalizeRelay(url);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(['relay', normalized]);
    if (out.length >= MAX_DM_RELAYS) break;
  }
  return out;
}
