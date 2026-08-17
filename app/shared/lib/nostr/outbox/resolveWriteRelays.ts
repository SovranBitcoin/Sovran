/**
 * @fileoverview Outbox write-relay routing (pure).
 *
 * Computes where an event should be published: the author's own NIP-65 write
 * relays, plus — for mentions/replies/DMs — each recipient's NIP-65 read relays
 * (the outbox model: write to the reader's inbox). Falls back to the default
 * bootstrap set whenever a side has no known relays, so a write never silently
 * targets nothing. Network fetching of recipient relay lists lives in the
 * integration layer; this function takes already-resolved relays so it stays
 * pure and unit-testable.
 */
import {
  DEFAULT_RELAYS,
  MAX_WRITE_RELAYS,
  normalizeRelayList,
} from '@/shared/lib/nostr/outbox/defaults';

export interface RecipientRelays {
  pubkey: string;
  /** The recipient's NIP-65 read relays (empty if unknown). */
  readRelays: readonly string[];
}

interface ResolveWriteRelaysInput {
  /** The active profile's own write relays (empty → defaults). */
  ownWriteRelays: readonly string[];
  /** Recipients whose read relays the event should also reach. */
  recipients?: readonly RecipientRelays[];
  /** Extra relay hints (e.g. from an nprofile / `p`-tag). */
  hintRelays?: readonly string[];
  /** Override the fan-out cap (defaults to {@link MAX_WRITE_RELAYS}). */
  maxRelays?: number;
}

/**
 * Resolves the final write-relay set. Own write relays always included; each
 * recipient contributes its read relays (or the defaults if it has none); the
 * union is normalized, deduped, and capped. Own relays are prioritized when
 * capping so the author's outbox is never dropped in favor of recipient relays.
 */
export function resolveWriteRelays(input: ResolveWriteRelaysInput): string[] {
  const cap = input.maxRelays ?? MAX_WRITE_RELAYS;

  const own = normalizeRelayList(input.ownWriteRelays);
  const ownOrDefault = own.length > 0 ? own : normalizeRelayList(DEFAULT_RELAYS);

  const recipientRelays: string[] = [];
  for (const recipient of input.recipients ?? []) {
    const reads = normalizeRelayList(recipient.readRelays);
    recipientRelays.push(...(reads.length > 0 ? reads : normalizeRelayList(DEFAULT_RELAYS)));
  }

  const hints = normalizeRelayList(input.hintRelays ?? []);

  // Own relays first so the cap never evicts the author's outbox.
  const ordered = [...ownOrDefault, ...recipientRelays, ...hints];
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const url of ordered) {
    if (seen.has(url)) continue;
    seen.add(url);
    deduped.push(url);
    if (deduped.length >= cap) break;
  }
  return deduped;
}
