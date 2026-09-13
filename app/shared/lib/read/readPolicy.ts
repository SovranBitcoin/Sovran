/**
 * First-paint policy per read surface — the one table log-doctor's `reads` and
 * `tiers` output is compared against.
 *
 * - `sequential`: the first answering tier IS the page (ordered lists never
 *   merge two rankings). `nostr.tier.select.*`.
 * - `session`: the notifications session — every tier opened at once, page
 *   released at `capMs` once at least one tier answered, later rows pooled to
 *   page boundaries. `nostr.notifications.session.paint`.
 * - `aggregate`: every tier opened at once, paint at `minItems` usable items
 *   or `capMs` (never empty while a source pends), later answers append in
 *   place. `nostr.tier.aggregate.*`. The nostr package owns the actual caps
 *   (`AGGREGATE_CAP_MS` in data-layer.ts); this table documents intent.
 * - `each`: no page at all — every datum paints as it lands through an entity
 *   cache key subscription (counts, per-row stats).
 */
import type { ReadSurface } from './readLog';

export type FirstPaintGate =
  | { kind: 'sequential' }
  | { kind: 'session'; capMs: number }
  | { kind: 'aggregate'; minItems: number | 'requested'; capMs: number; requireAll?: boolean }
  | { kind: 'each' };

export const READ_GATES: Record<ReadSurface, FirstPaintGate> = {
  feed: { kind: 'sequential' },
  thread: { kind: 'sequential' },
  notifications: { kind: 'session', capMs: 400 },
  followers: { kind: 'sequential' },
  dmConversations: { kind: 'sequential' },
  dmThread: { kind: 'sequential' },
  profile: { kind: 'aggregate', minItems: 1, capMs: 1000 },
  profileFeed: { kind: 'sequential' },
  profiles: { kind: 'aggregate', minItems: 'requested', capMs: 800 },
  profileStats: { kind: 'aggregate', minItems: 1, capMs: 1000 },
  searchProfiles: { kind: 'aggregate', minItems: 1, capMs: 300 },
  searchMints: { kind: 'sequential' },
  searchPosts: { kind: 'sequential' },
  noteStats: { kind: 'each' },
  socialGraph: { kind: 'aggregate', minItems: 1, capMs: 800 },
  discoverMints: { kind: 'sequential' },
  mintDetail: { kind: 'sequential' },
  mintReviews: { kind: 'aggregate', minItems: 1, capMs: 800 },
  mintAudit: { kind: 'sequential' },
  mintChanges: { kind: 'sequential' },
};
