import type { NostrCursor, NostrTier } from '@sovranbitcoin/schemas';
import type { RequestControls } from '../timeout';

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
// nagg paginates by event created_at; gift-wrap timestamps are randomized into
// the past, so the relay floor fetches without a limit. Incremental inbox callers
// may explicitly bound event created_at with since, allowing for randomization.
// ---------------------------------------------------------------------------

export type DmEnvelope = {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  tags: string[][];
  /** Randomized for gift wraps — display order is the client's job, post-decrypt. */
  createdAtSec: number;
  sig?: string;
};

export type DmEnvelopesRequest = RequestControls & {
  viewerPubkey: string;
  /** Event-time pagination cursor (nagg); ignored by the relay floor. */
  cursor?: NostrCursor;
  /** Inclusive event created_at lower bound; gift-wrap callers need an overlap. */
  since?: number;
  limit?: number;
  refresh?: boolean;
};

export type DmEnvelopesBundle = {
  envelopes: DmEnvelope[];
  cursor: NostrCursor;
  /**
   * How many wraps the tier sent, counting any left out because they did not
   * parse. A pager that judges "was this page full" by `envelopes.length`
   * would stop at the first page that lost one. Absent: `envelopes.length`.
   */
  received?: number;
};

export type ResolvedDmEnvelopes = {
  tier: NostrTier;
  envelopes: DmEnvelope[];
  cursor: NostrCursor;
  received?: number;
};

/** The wrap kinds the index serves: NIP-17 gift wrap + NIP-04 legacy. */
export const DM_ENVELOPE_KINDS = [4, 1059];
