import type { NostrCursor, NostrTier } from '@sovranbitcoin/schemas';
import { orderedEnvelopeEvents, type NaggEnvelope } from '../envelope';
import type { RequestControls } from '../timeout';
import type { TierOutcome } from '../tiers';

// ---------------------------------------------------------------------------
// DM conversation index surface
//
// The facade serves DMs only as an INDEX/ROUTER: it returns the OPAQUE encrypted
// envelopes (NIP-17 gift wraps kind 1059, NIP-04 kind 4 read-only legacy) that
// reference the viewer. Decryption, sender identification, and conversation
// bucketing are CLIENT-only, ABOVE the facade — a NIP-17 wrap hides the real
// sender inside the seal, so no tier can build a sender-keyed conversation list
// or per-peer unread. Tiers are pure transport for opaque envelopes.
//
// Pagination is by wrap ARRIVAL/ingest time, NOT event created_at: a gift wrap's
// created_at is randomized into the past, so ordering/filtering by it would
// silently drop conversations. nagg stores ingest time and paginates by it; the
// relay floor fetches with NO since/limit for the same reason.
// ---------------------------------------------------------------------------

export type DmEnvelope = {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  tags: string[][];
  /** Randomized for gift wraps — display order is the client's job, post-decrypt. */
  createdAt: number;
  sig?: string;
};

export type DmEnvelopesRequest = RequestControls & {
  viewerPubkey: string;
  /** Arrival-time cursor (nagg); ignored by the relay floor. */
  cursor?: NostrCursor;
  limit?: number;
  refresh?: boolean;
};

export type DmEnvelopesBundle = {
  envelopes: DmEnvelope[];
  cursor: NostrCursor;
};

export type ResolvedDmEnvelopes = {
  tier: NostrTier;
  envelopes: DmEnvelope[];
  cursor: NostrCursor;
};

export interface DmTier {
  readonly tier: NostrTier;
  getDmEnvelopes(request: DmEnvelopesRequest): Promise<TierOutcome<DmEnvelopesBundle>>;
}

/** The wrap kinds the index serves: NIP-17 gift wrap + NIP-04 legacy. */
export const DM_ENVELOPE_KINDS = [4, 1059];

/**
 * Bridge a v2 DM envelope into opaque DmEnvelopes. By design the DM routes
 * carry NO aggregates and NO profile hydration (privacy) — only the raw
 * encrypted wraps, ordered by arrival. The tail envelope is the next page's
 * cursor.
 */
export function bundleFromDmEnvelope(envelope: NaggEnvelope): DmEnvelopesBundle {
  const events = envelope.order.length > 0 ? orderedEnvelopeEvents(envelope) : envelope.events;
  const envelopes: DmEnvelope[] = events.map((e) => {
    const sig = (e as { sig?: unknown }).sig;
    return {
      id: e.id,
      pubkey: e.pubkey,
      kind: e.kind,
      content: e.content,
      tags: e.tags,
      createdAt: e.created_at,
      ...(typeof sig === 'string' && sig ? { sig } : {}),
    };
  });
  const last = envelopes[envelopes.length - 1];
  return { envelopes, cursor: last ? { createdAt: last.createdAt, id: last.id } : null };
}
