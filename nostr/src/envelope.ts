import { z } from 'zod';
import { NaggFeedEventSchema } from './schemas';
import type {
  NaggFeedEvent,
  NaggFeedItem,
  NaggFeedPage,
  NaggNoteMetrics,
  NaggOrderingManifest,
  NaggProfileInfo,
  NaggReposterInfo,
} from './map/feed';
import { firstTagValue } from './map/feed';

// ---------------------------------------------------------------------------
// nagg v2 envelope — ONE generic response shape for every app-view route
//
// nagg v2 collapses the per-route response bodies into a single envelope:
//
//   { order, orderBy, events, aggregates, cursor? }
//
// - `order` is the server-authoritative render order of ANCHOR event ids. For a
//   kind-6/16 repost item the anchor is the REFERENCED (original) event id, not
//   the repost's own id.
// - `events` carries the ordered items PLUS hydration: repost originals, thread
//   roots, quoted (q-tag) events, and each author's kind-0 profile event.
// - `aggregates` maps target id (event id — or pubkey on profile routes) →
//   rule name → metric → value. ZERO VALUES ARE OMITTED ENTIRELY, so every
//   accessor here defaults to 0.
// - `cursor` is opaque; echo it back for the next page. The feed routes encode
//   `"<until>|<offset>"`.
//
// This module is the ONE parser for that envelope: zod schemas for the envelope
// and its route extensions (notifications entries, profile providers, follow
// edges), plus reconstruction helpers that rebuild the canonical shapes the
// facade already exposes (`NaggFeedPage`, `NaggThread`, `NaggNotificationsPage`,
// metrics/profiles/quoted side maps) so the app-facing surface barely moves.
// ---------------------------------------------------------------------------

/**
 * A Go nil slice/map serializes to `null`, not `[]`/`{}` — tolerate both so an
 * empty view never fails the parse and silently drops a whole tier.
 */
function arrayOrEmpty<T extends z.ZodTypeAny>(value: T) {
  return z
    .array(value)
    .nullish()
    .transform((v): Array<z.infer<T>> => v ?? []);
}

export const NaggAggregatesSchema = z
  .record(z.string(), z.record(z.string(), z.record(z.string(), z.number())))
  .nullish()
  .transform((v): NaggAggregates => v ?? {});

export const NaggEnvelopeSchema = z
  .object({
    order: arrayOrEmpty(z.string()),
    orderBy: z.enum(['created_at', 'rank']).catch('created_at'),
    events: arrayOrEmpty(NaggFeedEventSchema),
    aggregates: NaggAggregatesSchema,
    cursor: z.string().nullish(),
  })
  .passthrough();

/** One actor inside a grouped notification entry. */
export const NaggNotificationEntryActorSchema = z
  .object({
    pubkey: z.string(),
    eventId: z.string(),
    createdAt: z.number(),
    actorVertexScore: z.number().optional(),
  })
  .passthrough();

/**
 * One notification entry: `id` is the triggering event's id (its raw event is
 * in `events`), `kind` its nostr kind, `actor` the (newest) acting pubkey and
 * `target` the viewer event it references, when there is one. There is NO
 * server reason string in v2 — the client derives it from the kind (and, for
 * kind-1, from the embedded event's tags): see {@link deriveNotificationReason}.
 */
export const NaggNotificationEntrySchema = z
  .object({
    id: z.string(),
    kind: z.number().int(),
    actor: z.string(),
    target: z.string().optional(),
    total: z.number().optional(),
    totalCapped: z.boolean().optional(),
    actors: z.array(NaggNotificationEntryActorSchema).nullish(),
  })
  .passthrough();

export const NaggNotificationsEnvelopeSchema = NaggEnvelopeSchema.extend({
  entries: arrayOrEmpty(NaggNotificationEntrySchema),
  hasNext: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false),
});

/** Per-provider enrichment on the profile routes, e.g. `vertex.{rank,score}`, `nip05.valid`. */
export const NaggProvidersSchema = z.record(
  z.string(),
  z.record(z.string(), z.record(z.string(), z.unknown())),
);

export const NaggProfilesEnvelopeSchema = NaggEnvelopeSchema.extend({
  /** Complete ranked pubkey list (includes profiles without a local kind-0). */
  pubkeys: arrayOrEmpty(z.string()),
  providers: NaggProvidersSchema.nullish().transform(
    (v): z.infer<typeof NaggProvidersSchema> => v ?? {},
  ),
  fromCache: z.boolean().optional(),
});

export const NaggFollowStatusEnvelopeSchema = NaggEnvelopeSchema.extend({
  edges: z
    .record(z.string(), z.object({ out: z.boolean(), in: z.boolean() }))
    .nullish()
    .transform((v): Record<string, { out: boolean; in: boolean }> => v ?? {}),
});

export type NaggAggregates = Record<string, Record<string, Record<string, number>>>;
export type NaggEnvelope = z.infer<typeof NaggEnvelopeSchema>;
export type NaggNotificationEntry = z.infer<typeof NaggNotificationEntrySchema>;
export type NaggNotificationsEnvelope = z.infer<typeof NaggNotificationsEnvelopeSchema>;
export type NaggProfilesEnvelope = z.infer<typeof NaggProfilesEnvelopeSchema>;
export type NaggFollowStatusEnvelope = z.infer<typeof NaggFollowStatusEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Aggregate rules — server rule names → the friendly fields the facade exposes
// ---------------------------------------------------------------------------

export const AGGREGATE_RULES = {
  /** Reaction/like count (distinct reactors). */
  likeCount: { rule: 'k7_e', metric: 'actors' },
  /** Repost count (distinct reposters, kinds 6/16). */
  repostCount: { rule: 'k6_16_e', metric: 'actors' },
  /** Reply count (kind 1/1111 replies). */
  replyCount: { rule: 'k1_1111_e_reply', metric: 'sources' },
  /** Quote count (kind-1 q-tag quotes). */
  quoteCount: { rule: 'k1_q', metric: 'sources' },
  /** Total sats zapped. */
  satsZapped: { rule: 'k9735_e', metric: 'value_total' },
  /** Zap receipt count. */
  zapCount: { rule: 'k9735_e', metric: 'sources' },
  /** Vertex-gated "real" like count. */
  realLikeCount: { rule: 'vertex_k7_e', metric: 'actors' },
  /** Distinct vertex-scored ("real") engagers across all engagement kinds. */
  realEngagerCount: { rule: 'vertex_actors', metric: 'actors' },
  // --- pubkey-keyed (profile routes) ---
  /** Followers: distinct authors whose latest kind-3 p-tags the pubkey. */
  followers: { rule: 'k3_p_latest', metric: 'actors' },
  /** Following: p-tag count of the pubkey's own latest kind-3. */
  following: { rule: 'k3_author_latest', metric: 'sources' },
  /** Created-event (post) count. */
  postCount: { rule: 'k1_1111_author', metric: 'sources' },
} as const;

export type AggregateRuleName = keyof typeof AGGREGATE_RULES;

/**
 * Raw accessor: the value of one rule metric for one target (event id or
 * pubkey), or `undefined` when the server omitted it (zero values are omitted).
 */
export function aggregateValue(
  aggregates: NaggAggregates,
  targetId: string,
  name: AggregateRuleName,
): number | undefined {
  const { rule, metric } = AGGREGATE_RULES[name];
  return aggregates[targetId]?.[rule]?.[metric];
}

/** Friendly per-note metrics for one event id, zero-defaulted. */
export function noteMetricsFromAggregates(
  aggregates: NaggAggregates,
  id: string,
): NaggNoteMetrics {
  return {
    likeCount: aggregateValue(aggregates, id, 'likeCount') ?? 0,
    repostCount: aggregateValue(aggregates, id, 'repostCount') ?? 0,
    replyCount: aggregateValue(aggregates, id, 'replyCount') ?? 0,
    satsZapped: aggregateValue(aggregates, id, 'satsZapped') ?? 0,
    zapCount: aggregateValue(aggregates, id, 'zapCount') ?? 0,
    quoteCount: aggregateValue(aggregates, id, 'quoteCount') ?? 0,
  };
}

/**
 * The metrics side map the facade shapes carry: every aggregated event id plus
 * every id in `ensureIds`, zero-filled where the server omitted the value.
 */
export function noteMetricsMapFromAggregates(
  aggregates: NaggAggregates,
  ensureIds: Iterable<string> = [],
): Record<string, NaggNoteMetrics> {
  const out: Record<string, NaggNoteMetrics> = {};
  for (const id of Object.keys(aggregates)) out[id] = noteMetricsFromAggregates(aggregates, id);
  for (const id of ensureIds) {
    if (!(id in out)) out[id] = noteMetricsFromAggregates(aggregates, id);
  }
  return out;
}

export type NaggProfileCounts = {
  followers: number;
  following: number;
  postCount: number;
};

/** Friendly per-pubkey counts for the profile routes, zero-defaulted. */
export function profileCountsFromAggregates(
  aggregates: NaggAggregates,
  pubkey: string,
): NaggProfileCounts {
  return {
    followers: aggregateValue(aggregates, pubkey, 'followers') ?? 0,
    following: aggregateValue(aggregates, pubkey, 'following') ?? 0,
    postCount: aggregateValue(aggregates, pubkey, 'postCount') ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Event reconstruction
// ---------------------------------------------------------------------------

export function envelopeEventsById(envelope: NaggEnvelope): Map<string, NaggFeedEvent> {
  const byId = new Map<string, NaggFeedEvent>();
  for (const event of envelope.events) byId.set(event.id, event);
  return byId;
}

/** The events `order` resolves to, in order; unresolvable anchors are skipped. */
export function orderedEnvelopeEvents(envelope: NaggEnvelope): NaggFeedEvent[] {
  const byId = envelopeEventsById(envelope);
  const out: NaggFeedEvent[] = [];
  for (const id of envelope.order) {
    const event = byId.get(id);
    if (event) out.push(event);
  }
  return out;
}

/** Parse a feed-route cursor (`"<until>|<offset>"`). Opaque otherwise → null. */
export function parseEnvelopeCursor(
  cursor: string | null | undefined,
): { until: number; offset: number } | null {
  if (!cursor) return null;
  const [untilRaw, offsetRaw] = cursor.split('|');
  const until = Number(untilRaw);
  if (!Number.isFinite(until)) return null;
  const offset = Number(offsetRaw);
  return { until, offset: Number.isFinite(offset) ? offset : 0 };
}

// ---------------------------------------------------------------------------
// Profiles — kind-0 extraction
// ---------------------------------------------------------------------------

export type ProfileMetadata = {
  name?: string;
  displayName?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
  about?: string;
};

/**
 * Parse a kind-0 event's `content` JSON into ProfileMetadata. Tolerant: unknown
 * fields ignored, `display_name`/`displayName` both accepted, null on bad JSON.
 */
export function parseProfileMetadata(content: string): ProfileMetadata | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null) return null;
  const o = json as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const metadata: ProfileMetadata = {
    name: str(o.name),
    displayName: str(o.display_name) ?? str(o.displayName),
    picture: str(o.picture),
    banner: str(o.banner),
    nip05: str(o.nip05),
    lud16: str(o.lud16),
    website: str(o.website),
    about: str(o.about),
  };
  // Drop a profile that carried nothing useful.
  return Object.values(metadata).some((v) => v !== undefined) ? metadata : null;
}

/** Latest kind-0 event per pubkey found in the envelope's hydration. */
export function latestKind0ByPubkey(envelope: NaggEnvelope): Map<string, NaggFeedEvent> {
  const latest = new Map<string, NaggFeedEvent>();
  for (const event of envelope.events) {
    if (event.kind !== 0) continue;
    const current = latest.get(event.pubkey);
    if (!current || event.created_at > current.created_at) latest.set(event.pubkey, event);
  }
  return latest;
}

/** Full kind-0 metadata per pubkey (for the search/profile surfaces). */
export function profileMetadataByPubkey(envelope: NaggEnvelope): Record<string, ProfileMetadata> {
  const out: Record<string, ProfileMetadata> = {};
  for (const [pubkey, event] of latestKind0ByPubkey(envelope)) {
    const metadata = parseProfileMetadata(event.content);
    if (metadata) out[pubkey] = metadata;
  }
  return out;
}

/**
 * The minimal `{ name, picture }` profile side map the feed/thread/notification
 * shapes carry (what v1's server-built `profiles` map held).
 */
export function profileInfoMapFromEnvelope(envelope: NaggEnvelope): Record<string, NaggProfileInfo> {
  const out: Record<string, NaggProfileInfo> = {};
  for (const [pubkey, event] of latestKind0ByPubkey(envelope)) {
    const metadata = parseProfileMetadata(event.content);
    if (!metadata) continue;
    const name = metadata.name ?? metadata.displayName;
    if (!name && !metadata.picture) continue;
    out[pubkey] = {
      name: name ?? '',
      ...(metadata.picture ? { picture: metadata.picture } : {}),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Feed reconstruction — anchors → feed items
// ---------------------------------------------------------------------------

const REPOST_KINDS = new Set([6, 16]);

/** NIP-10 root: the e-tag marked `root`, else (legacy positional) the first e-tag. */
function rootEventIdOf(event: NaggFeedEvent): string | undefined {
  let firstE: string | undefined;
  for (const tag of event.tags) {
    if (tag[0] !== 'e' || typeof tag[1] !== 'string') continue;
    if (firstE === undefined) firstE = tag[1];
    if (tag[2] === 'root' || tag[3] === 'root') return tag[1];
  }
  return firstE;
}

/** Index the envelope's kind-6/16 events by the original event id they repost. */
function repostsByOriginalId(envelope: NaggEnvelope): Map<string, NaggFeedEvent[]> {
  const out = new Map<string, NaggFeedEvent[]>();
  for (const event of envelope.events) {
    if (!REPOST_KINDS.has(event.kind)) continue;
    const originalId = firstTagValue(event, 'e');
    if (!originalId) continue;
    const list = out.get(originalId);
    if (list) list.push(event);
    else out.set(originalId, [event]);
  }
  return out;
}

export type ResolvedAnchor =
  | { anchorId: string; kind: 'note'; event: NaggFeedEvent }
  | {
      anchorId: string;
      kind: 'repost';
      /** The (newest) kind-6/16 repost event. */
      repost: NaggFeedEvent;
      /** The reposted original — undefined when nagg has not hydrated/indexed it. */
      original: NaggFeedEvent | undefined;
      reposts: NaggFeedEvent[];
    }
  | { anchorId: string; kind: 'missing' };

/**
 * Resolve each `order` anchor against the envelope's events: a plain event id
 * → note; an id some kind-6/16 event references → `{ repost, original }` (the
 * anchor IS the original's id); an id with no backing event at all → missing.
 */
export function resolveAnchors(envelope: NaggEnvelope): ResolvedAnchor[] {
  const byId = envelopeEventsById(envelope);
  const reposts = repostsByOriginalId(envelope);
  return envelope.order.map((anchorId): ResolvedAnchor => {
    const repostEvents = reposts.get(anchorId);
    const event = byId.get(anchorId);
    if (repostEvents && repostEvents.length > 0) {
      const sorted = [...repostEvents].sort((a, b) => b.created_at - a.created_at);
      return { anchorId, kind: 'repost', repost: sorted[0], original: event, reposts: sorted };
    }
    if (event) return { anchorId, kind: 'note', event };
    return { anchorId, kind: 'missing' };
  });
}

/** The ordered, renderable feed items (missing anchors are skipped here; the
 *  full order — including unresolved ids — rides on the page's manifest). */
export function orderedFeedItemsFromEnvelope(envelope: NaggEnvelope): NaggFeedItem[] {
  const byId = envelopeEventsById(envelope);
  const items: NaggFeedItem[] = [];
  for (const anchor of resolveAnchors(envelope)) {
    if (anchor.kind === 'missing') continue;
    if (anchor.kind === 'repost') {
      const reposters: NaggReposterInfo[] = anchor.reposts.map((event) => ({
        pubkey: event.pubkey,
        event,
      }));
      const rootId = anchor.original ? rootEventIdOf(anchor.original) : undefined;
      items.push({
        type: 'repost',
        repostEvent: anchor.repost,
        originalEvent: anchor.original ?? null,
        originalEventId: anchor.anchorId,
        ...(rootId ? { rootEventId: rootId, rootEvent: byId.get(rootId) ?? null } : {}),
        reposters,
      });
      continue;
    }
    const rootId = rootEventIdOf(anchor.event);
    items.push({
      type: 'note',
      event: anchor.event,
      ...(rootId ? { rootEventId: rootId, rootEvent: byId.get(rootId) ?? null } : {}),
    });
  }
  return items;
}

/** The q-tag-quoted events referenced by `sources` that the envelope hydrated. */
function quotedMap(
  byId: Map<string, NaggFeedEvent>,
  sources: Iterable<NaggFeedEvent>,
): Record<string, NaggFeedEvent> {
  const out: Record<string, NaggFeedEvent> = {};
  for (const event of sources) {
    for (const tag of event.tags) {
      if (tag[0] !== 'q' || typeof tag[1] !== 'string') continue;
      const quoted = byId.get(tag[1]);
      if (quoted) out[tag[1]] = quoted;
    }
  }
  return out;
}

/** Every content event a feed item renders (note/original/root), for quote scans. */
function feedItemContentEvents(items: readonly NaggFeedItem[]): NaggFeedEvent[] {
  const out: NaggFeedEvent[] = [];
  for (const item of items) {
    if (item.type === 'note') {
      out.push(item.event);
      if (item.rootEvent) out.push(item.rootEvent);
    } else {
      if (item.originalEvent) out.push(item.originalEvent);
      if (item.rootEvent) out.push(item.rootEvent);
    }
  }
  return out;
}

/**
 * Rebuild the canonical `NaggFeedPage` (v1's feed shape, which the facade's
 * `bundleFromFeedPage` and the app's `mapNaggFeedPage` already consume) from a
 * v2 envelope. The ordering manifest carries the FULL server order — including
 * anchors whose events were not hydrated — so the facade can surface
 * `missingIds` for lazy backfill.
 */
export function feedPageFromEnvelope(envelope: NaggEnvelope): NaggFeedPage {
  const byId = envelopeEventsById(envelope);
  const items = orderedFeedItemsFromEnvelope(envelope);
  const contentEvents = feedItemContentEvents(items);

  const metricIds = new Set<string>();
  for (const item of items) {
    metricIds.add(item.type === 'note' ? item.event.id : item.originalEventId ?? item.repostEvent.id);
    if (item.rootEventId) metricIds.add(item.rootEventId);
  }

  const ordering: NaggOrderingManifest = { orderBy: envelope.orderBy, elements: [...envelope.order] };
  const cursor = parseEnvelopeCursor(envelope.cursor);

  return {
    items,
    ordering,
    metrics: noteMetricsMapFromAggregates(envelope.aggregates, metricIds),
    profiles: profileInfoMapFromEnvelope(envelope),
    quoted: quotedMap(byId, contentEvents),
    paginationUntil: cursor?.until ?? 0,
    paginationOffset: cursor?.offset ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Thread reconstruction — order[0] is the root, the rest are ranked replies
// ---------------------------------------------------------------------------

/** The structural thread shape (v1's `ThreadResponse`), fed to `bundleFromThread`. */
export type NaggThread = {
  root: NaggFeedEvent;
  events: NaggFeedEvent[];
  ordering?: NaggOrderingManifest;
  metrics: Record<string, NaggNoteMetrics>;
  profiles: Record<string, NaggProfileInfo>;
  quoted: Record<string, NaggFeedEvent>;
};

/**
 * Rebuild the thread view: `order[0]` is the root id, the remaining anchors are
 * the server-ranked reply ids. Returns null when the root event is missing from
 * the envelope (nothing to render — let the caller fall through).
 */
export function threadFromEnvelope(envelope: NaggEnvelope): NaggThread | null {
  const byId = envelopeEventsById(envelope);
  const rootId = envelope.order[0];
  const root = rootId ? byId.get(rootId) : undefined;
  if (!root) return null;

  const replyIds = envelope.order.slice(1);
  const events: NaggFeedEvent[] = [];
  for (const id of replyIds) {
    const event = byId.get(id);
    if (event) events.push(event);
  }

  const metricIds = new Set<string>([root.id, ...replyIds]);
  return {
    root,
    events,
    ordering: { orderBy: envelope.orderBy, elements: replyIds },
    metrics: noteMetricsMapFromAggregates(envelope.aggregates, metricIds),
    profiles: profileInfoMapFromEnvelope(envelope),
    quoted: quotedMap(byId, [root, ...events]),
  };
}

// ---------------------------------------------------------------------------
// Notifications — entries + client-side reason derivation
// ---------------------------------------------------------------------------

export type NotificationReason =
  | 'follow'
  | 'repost'
  | 'reaction'
  | 'zap'
  | 'reply'
  | 'quote'
  | 'mention';

/**
 * v2 sends NO reason strings. Derive: kind 3 = follow, 6/16 = repost, 7 =
 * reaction, 9735 = zap. A kind-1/1111 entry splits on the embedded event's
 * tags: a q tag (on the entry's target when known) → quote; an e tag pointing
 * at a viewer post (the entry's target, or any e tag when the target is not
 * carried) → reply; else → mention.
 */
export function deriveNotificationReason(
  entry: Pick<NaggNotificationEntry, 'kind' | 'target'>,
  event: Pick<NaggFeedEvent, 'tags'> | undefined,
): NotificationReason | undefined {
  switch (entry.kind) {
    case 3:
      return 'follow';
    case 6:
    case 16:
      return 'repost';
    case 7:
      return 'reaction';
    case 9735:
      return 'zap';
    case 1:
    case 1111: {
      const tags = event?.tags ?? [];
      const qTags = tags.filter((t) => t[0] === 'q' && typeof t[1] === 'string').map((t) => t[1]);
      const eTags = tags.filter((t) => t[0] === 'e' && typeof t[1] === 'string').map((t) => t[1]);
      if (qTags.length > 0 && (!entry.target || qTags.includes(entry.target))) return 'quote';
      if (eTags.length > 0 && (!entry.target || eTags.includes(entry.target))) return 'reply';
      if (qTags.length > 0) return 'quote';
      if (eTags.length > 0) return 'reply';
      return 'mention';
    }
    default:
      return undefined;
  }
}

/** One reconstructed notification node (v1's node shape, reason derived client-side). */
export type NaggNotificationNode = {
  type?: 'single' | 'group';
  event: NaggFeedEvent;
  reason: string;
  actorVertexScore: number;
  total?: number;
  totalCapped?: boolean;
  sampleActors?: Array<{
    pubkey: string;
    eventId: string;
    createdAt: number;
    actorVertexScore?: number;
  }>;
  targetEventId?: string;
  targetEvent?: NaggFeedEvent;
};

/** The reconstructed notifications page (v1's canonical shape + hasNext). */
export type NaggNotificationsPage = {
  notifications: {
    nodes: NaggNotificationNode[];
    pageInfo?: { endCursor?: unknown; hasNextPage?: boolean };
  };
  metrics: Record<string, NaggNoteMetrics>;
  profiles: Record<string, NaggProfileInfo>;
  quoted: Record<string, NaggFeedEvent>;
};

/**
 * Rebuild the notifications page from the v2 envelope's `entries`. Grouping is
 * server-side and unchanged: follow/repost/reaction/zap entries are collapsed
 * groups (`type: 'group'`, total + sample actors); reply/quote/mention entries
 * stay `type: 'single'`. Entries whose triggering event was not hydrated, or
 * whose kind has no reason mapping, are dropped.
 */
export function notificationsPageFromEnvelope(
  envelope: NaggNotificationsEnvelope,
): NaggNotificationsPage {
  const byId = envelopeEventsById(envelope);
  const nodes: NaggNotificationNode[] = [];
  const metricIds = new Set<string>();

  for (const entry of envelope.entries) {
    const event = byId.get(entry.id);
    if (!event) continue;
    const reason = deriveNotificationReason(entry, event);
    if (!reason) continue;

    const actors = entry.actors ?? [];
    const grouped = reason === 'follow' || reason === 'repost' || reason === 'reaction' || reason === 'zap';
    const targetEvent = entry.target ? byId.get(entry.target) : undefined;
    if (entry.target) metricIds.add(entry.target);

    nodes.push({
      type: grouped ? 'group' : 'single',
      event,
      reason,
      actorVertexScore: actors[0]?.actorVertexScore ?? 0,
      ...(grouped ? { total: entry.total ?? Math.max(actors.length, 1) } : {}),
      ...(entry.totalCapped !== undefined ? { totalCapped: entry.totalCapped } : {}),
      ...(actors.length > 0 ? { sampleActors: actors } : {}),
      ...(entry.target ? { targetEventId: entry.target } : {}),
      ...(targetEvent ? { targetEvent } : {}),
    });
  }

  return {
    notifications: {
      nodes,
      pageInfo: { hasNextPage: envelope.hasNext },
    },
    metrics: noteMetricsMapFromAggregates(envelope.aggregates, metricIds),
    profiles: profileInfoMapFromEnvelope(envelope),
    quoted: quotedMap(byId, nodes.map((n) => n.event)),
  };
}

// ---------------------------------------------------------------------------
// Simple per-route reconstructions
// ---------------------------------------------------------------------------

/** v1's `/nostr/notes/stats` map, now served by `POST /nostr/events/aggregates`. */
export function noteStatsFromEnvelope(envelope: NaggEnvelope): Record<string, NaggNoteMetrics> {
  return noteMetricsMapFromAggregates(envelope.aggregates);
}

/** v1's enrichment side maps (`/nostr/events` + `/nostr/profiles` consumers). */
export type NaggEnrichment = {
  metrics: Record<string, NaggNoteMetrics>;
  profiles: Record<string, NaggProfileInfo>;
  /** The requested/hydrated non-profile events, keyed by id. */
  quoted: Record<string, NaggFeedEvent>;
};

export function enrichmentFromEnvelope(envelope: NaggEnvelope): NaggEnrichment {
  const quoted: Record<string, NaggFeedEvent> = {};
  for (const event of envelope.events) {
    if (event.kind !== 0) quoted[event.id] = event;
  }
  return {
    metrics: noteMetricsMapFromAggregates(envelope.aggregates),
    profiles: profileInfoMapFromEnvelope(envelope),
    quoted,
  };
}

export type NaggFollowStatusEdgeRow = {
  pubkey: string;
  following: boolean;
  followsYou: boolean;
  mutual: boolean;
  relationship: 'following' | 'follows_you' | 'mutual' | 'none';
};

/** Derive v1's follow-status rows from the v2 `edges` map (mutual = out && in). */
export function followStatusRowsFromEnvelope(
  envelope: NaggFollowStatusEnvelope,
): NaggFollowStatusEdgeRow[] {
  return Object.entries(envelope.edges).map(([pubkey, edge]) => {
    const mutual = edge.out && edge.in;
    return {
      pubkey,
      following: edge.out,
      followsYou: edge.in,
      mutual,
      relationship: mutual
        ? 'mutual'
        : edge.out
          ? 'following'
          : edge.in
            ? 'follows_you'
            : 'none',
    };
  });
}

export type NaggOwnProfileRow = ProfileMetadata & {
  pubkey: string;
  followers: number;
  follows: number;
  createdAt?: number;
};

/** v1's own-profiles rows: kind-0 metadata + follower/following aggregates. */
export function ownProfilesFromEnvelope(envelope: NaggProfilesEnvelope): NaggOwnProfileRow[] {
  const kind0 = latestKind0ByPubkey(envelope);
  const pubkeys = new Set<string>([
    ...(envelope.pubkeys ?? []),
    ...kind0.keys(),
    ...Object.keys(envelope.aggregates),
  ]);
  const rows: NaggOwnProfileRow[] = [];
  for (const pubkey of pubkeys) {
    const event = kind0.get(pubkey);
    const metadata = event ? parseProfileMetadata(event.content) : null;
    const counts = profileCountsFromAggregates(envelope.aggregates, pubkey);
    rows.push({
      pubkey,
      ...(metadata ?? {}),
      followers: counts.followers,
      follows: counts.following,
      ...(event ? { createdAt: event.created_at } : {}),
    });
  }
  return rows;
}

/**
 * Parse the `/nostr/notifications/seen` marker (a kind-30078 event whose
 * content carries the seen-until watermark). Accepts a bare number, a numeric
 * string, or `{ "seenUntil": <n> }`. Null when the envelope has no marker.
 */
export function seenUntilFromEnvelope(envelope: NaggEnvelope): number | null {
  const marker = envelope.events.find((e) => e.kind === 30_078) ?? envelope.events[0];
  if (!marker) return null;
  const content = marker.content.trim();
  const direct = Number(content);
  if (content.length > 0 && Number.isFinite(direct)) return direct;
  try {
    const json: unknown = JSON.parse(content);
    if (typeof json === 'number' && Number.isFinite(json)) return json;
    if (typeof json === 'object' && json !== null) {
      const value = (json as Record<string, unknown>).seenUntil;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
  } catch {
    return null;
  }
  return null;
}
