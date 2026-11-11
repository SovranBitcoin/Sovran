/**
 * The tier engine each read surface resolves through, as its
 * `read.<surface>.request` log records it — what log-doctor's `reads` and
 * `tiers` output is compared against. The nostr package owns the engines and
 * their caps (`AGGREGATE_CAP_MS` in data-layer.ts, the notifications session
 * gate); this table only names which one a surface uses.
 *
 * - `sequential`: the first answering tier IS the page (ordered lists never
 *   merge two rankings). `nostr.tier.select.*`.
 * - `session`: the notifications session — every tier opened at once, page
 *   released at a time cap once at least one tier answered, later rows pooled
 *   to page boundaries. `nostr.notifications.session.paint`.
 * - `aggregate`: every tier opened at once, paint at enough usable items or a
 *   time cap (never empty while a source pends), later answers append in
 *   place. `nostr.tier.aggregate.*`.
 * - `http`: no page at all — every datum paints as it lands through an entity
 *   cache key subscription (counts, per-row stats).
 */
import type { ReadStrategy, ReadSurface } from './readLog';

const READ_STRATEGIES: Record<ReadSurface, ReadStrategy> = {
  feed: 'sequential',
  thread: 'sequential',
  notifications: 'session',
  followers: 'sequential',
  dmConversations: 'sequential',
  dmThread: 'sequential',
  profile: 'aggregate',
  profileFeed: 'sequential',
  profiles: 'aggregate',
  profileStats: 'aggregate',
  searchProfiles: 'aggregate',
  searchMints: 'sequential',
  searchPosts: 'sequential',
  noteStats: 'http',
  socialGraph: 'aggregate',
  discoverMints: 'sequential',
  mintDetail: 'sequential',
  mintReviews: 'aggregate',
  mintAudit: 'sequential',
  mintChanges: 'sequential',
  // Relay-only in practice: nagg answers `unsupported` for the DM index, so the
  // first answering tier is the page.
  paymentRequestInbox: 'sequential',
};

/** The `strategy` a surface's `read.<surface>.request` carries. */
export function readStrategyFor(surface: ReadSurface): ReadStrategy {
  return READ_STRATEGIES[surface];
}
