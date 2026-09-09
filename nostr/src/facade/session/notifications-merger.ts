import type { NotificationSortKey } from "../notifications";
import type { NostrTier, NoteStatsMap } from '@sovranbitcoin/schemas';
import type { NaggFeedEvent, NaggProfileInfo } from '../../map/feed';
import { sourceRank } from '../cache/entity-cache';
import type { NotificationActor, NotificationItem, NotificationsBundle } from '../notifications';

// ---------------------------------------------------------------------------
// Notifications merger — the unification core of the three-source session.
//
// One row per merge key across every source, page, live event, and re-poll.
// The rules, exactly:
//
//   Identity   groupable reasons (follow/repost/reaction/zap) collapse on
//              reason:target (follow on the constant `follow`); reply/quote/
//              mention rows are the event itself. This matches the app's
//              notificationDedupeKey — NOT notificationKey, whose reason:target
//              would collapse two distinct replies to one post.
//   Shape      the highest-ranked source (nagg > primal > relay — the entity
//              cache's TIER_RANK) owns the row's rendered shape; lower sources
//              may only FILL absent targetEvent/targetEventId.
//   Counting   evidence is deduped by evidence id (the actor's engagement
//              event id; Primal summaries get a synthetic one), but `total`
//              counts DISTINCT ACTOR PUBKEYS — one actor's ❤️ then 🤙 is one
//              person, and the same like seen via Primal and relay under two
//              evidence ids still counts once. Zaps are the exception (counted
//              by evidence id): a relay kind-9735 `pubkey` is the LNURL
//              service, not the sender, so it is blanked and useless for
//              actor identity. total = max(nagg's authoritative total,
//              distinct evidence); a fresher nagg total re-baselines.
//   Stability  a revealed row's sort position (sortAt) is FROZEN at reveal;
//              upgrades never move it. New keys stay POOLED (sortAt null)
//              until reveal() — the session calls it only at page boundaries,
//              which is what keeps the visible list shift-free.
// ---------------------------------------------------------------------------

/** Order newest first, with an id-descending tiebreaker. */
function compareNewestFirst(
  a: NotificationSortKey,
  b: NotificationSortKey,
): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

const GROUPABLE = new Set(['follow', 'repost', 'reaction', 'zap']);

/** Session-level row identity — the app's notificationDedupeKey semantics. */
export function notificationMergeKey(item: NotificationItem): string {
  if (item.reason === 'follow') return 'follow';
  const target = typeof item.targetEventId === 'string' ? item.targetEventId : item.event.id;
  if (GROUPABLE.has(item.reason)) return `${item.reason}:${target}`;
  return `${item.reason}:${item.event.id}`;
}

type MergedRow = {
  key: string;
  item: NotificationItem;
  /** Rank of the source that owns the row's shape. */
  srcRank: number;
  /** Frozen at reveal; null while pooled. Upgrades never move a revealed row. */
  sortAt: NotificationSortKey | null;
  /** evidenceId → actor pubkey ('' when unknowable, e.g. relay zap receipts). */
  evidence: Map<string, string>;
  /** nagg's authoritative total for this key, when nagg has answered. */
  naggTotal?: number;
  totalCapped: boolean;
};

export type MergerEntities = Pick<NotificationsBundle, 'stats' | 'profiles' | 'quoted'>;

export interface NotificationsMerger {
  /** Merge one source page / live batch. Reports in-place changes vs new keys. */
  ingest(tier: NostrTier, items: readonly NotificationItem[]): { updated: string[]; created: string[] };
  /** Merge a bundle's entity side maps, rank-aware. */
  mergeEntities(tier: NostrTier, entities: MergerEntities): void;
  /** Reveal up to `limit` pooled rows (newest first), freezing their sortAt. */
  reveal(limit: number): string[];
  revealedCount(): number;
  pooledCount(): number;
  /** Ordered projection of the revealed rows + merged entity maps. */
  snapshot(): {
    notifications: NotificationItem[];
    stats: NoteStatsMap;
    profiles: Record<string, NaggProfileInfo>;
    quoted: Record<string, NaggFeedEvent>;
  };
}

/** Shape fields a higher-ranked source replaces wholesale. */
const SHAPE_FIELDS = [
  'type',
  'event',
  'total',
  'totalCapped',
  'sampleActors',
  'targetEvent',
  'targetEventId',
  'actorVertexScore',
] as const;

function evidenceOf(item: NotificationItem): Array<{ id: string; pubkey: string }> {
  if (item.type === 'group' && item.sampleActors?.length) {
    const out = [{ id: item.event.id, pubkey: item.event.pubkey }];
    for (const actor of item.sampleActors) {
      if (actor.eventId !== item.event.id) out.push({ id: actor.eventId, pubkey: actor.pubkey });
    }
    return out;
  }
  // Relay 9735: `pubkey` is the LNURL service, not the sender — blank it so
  // distinct-actor counting can't collapse every zap into one "actor".
  const pubkey = item.event.kind === 9735 ? '' : item.event.pubkey;
  return [{ id: item.event.id, pubkey }];
}

function synthesizeSampleActors(row: MergedRow): NotificationActor[] {
  const seen = new Set<string>();
  const actors: NotificationActor[] = [];
  for (const [id, pubkey] of row.evidence) {
    if (!pubkey || seen.has(pubkey)) continue;
    seen.add(pubkey);
    actors.push({ pubkey, eventId: id, createdAt: row.item.event.created_at });
    if (actors.length >= 3) break;
  }
  return actors;
}

export function createNotificationsMerger(): NotificationsMerger {
  const rows = new Map<string, MergedRow>();
  const revealed: MergedRow[] = [];

  function recomputeGroupShape(row: MergedRow): boolean {
    if (!GROUPABLE.has(row.item.reason)) return false;
    const pubkeys = new Set([...row.evidence.values()].filter(Boolean));
    const distinct = row.item.reason === 'zap' ? Math.max(pubkeys.size, row.evidence.size) : pubkeys.size;
    const total = Math.max(row.naggTotal ?? 0, distinct);
    if (total <= 1 && row.item.type !== 'group') return false;
    const before = row.item.total;
    // nagg's own sampleActors (rank-owned shape) win; otherwise synthesize
    // from evidence so the app's server-group branch renders the cluster.
    const keepActors = row.srcRank >= sourceRank('nagg') && row.item.sampleActors?.length;
    row.item = {
      ...row.item,
      type: 'group',
      total,
      ...(row.totalCapped ? { totalCapped: true } : {}),
      sampleActors: keepActors ? row.item.sampleActors : synthesizeSampleActors(row),
    };
    return row.item.total !== before;
  }

  function mergeItem(row: MergedRow, tier: NostrTier, item: NotificationItem): boolean {
    const rank = sourceRank(tier);
    let changed = false;
    if (rank > row.srcRank) {
      const next: NotificationItem = { ...row.item };
      for (const field of SHAPE_FIELDS) {
        if (item[field] !== undefined && item[field] !== row.item[field]) {
          (next as Record<string, unknown>)[field] = item[field];
          changed = true;
        }
      }
      row.item = next;
      row.srcRank = rank;
    } else {
      for (const field of ['targetEvent', 'targetEventId'] as const) {
        if (row.item[field] === undefined && item[field] !== undefined) {
          row.item = { ...row.item, [field]: item[field] };
          changed = true;
        }
      }
    }
    if (tier === 'nagg' && typeof item.total === 'number') {
      if (row.naggTotal !== item.total) changed = true;
      row.naggTotal = item.total;
      row.totalCapped = item.totalCapped === true;
    }
    for (const ev of evidenceOf(item)) {
      if (!row.evidence.has(ev.id)) {
        row.evidence.set(ev.id, ev.pubkey);
        changed = true;
      } else if (ev.pubkey && !row.evidence.get(ev.id)) {
        row.evidence.set(ev.id, ev.pubkey);
        changed = true;
      }
    }
    return recomputeGroupShape(row) || changed;
  }

  const stats: NoteStatsMap = {};
  const statsRank = new Map<string, number>();
  const profiles: Record<string, NaggProfileInfo> = {};
  const profilesRank = new Map<string, number>();
  const quoted: Record<string, NaggFeedEvent> = {};

  return {
    ingest(tier, items) {
      const updated: string[] = [];
      const created: string[] = [];
      for (const item of items) {
        const key = notificationMergeKey(item);
        const existing = rows.get(key);
        if (existing) {
          if (mergeItem(existing, tier, item) && existing.sortAt) updated.push(key);
          continue;
        }
        const row: MergedRow = {
          key,
          item,
          srcRank: sourceRank(tier),
          sortAt: null,
          evidence: new Map(),
          totalCapped: item.totalCapped === true,
        };
        if (tier === 'nagg' && typeof item.total === 'number') row.naggTotal = item.total;
        for (const ev of evidenceOf(item)) row.evidence.set(ev.id, ev.pubkey);
        recomputeGroupShape(row);
        rows.set(key, row);
        created.push(key);
      }
      return { updated, created };
    },

    mergeEntities(tier, entities) {
      const rank = sourceRank(tier);
      for (const [id, value] of Object.entries(entities.stats)) {
        if ((statsRank.get(id) ?? -1) <= rank) {
          stats[id] = value;
          statsRank.set(id, rank);
        }
      }
      for (const [pubkey, value] of Object.entries(entities.profiles)) {
        const existing = profiles[pubkey];
        if (!existing || (profilesRank.get(pubkey) ?? -1) <= rank || !existing.picture) {
          profiles[pubkey] = value;
          profilesRank.set(pubkey, rank);
        }
      }
      for (const [id, value] of Object.entries(entities.quoted)) {
        if (!quoted[id]) quoted[id] = value;
      }
    },

    reveal(limit) {
      const pooled = [...rows.values()].filter((row) => row.sortAt === null);
      pooled.sort((a, b) =>
        compareNewestFirst(
          { createdAt: a.item.event.created_at, id: a.item.event.id },
          { createdAt: b.item.event.created_at, id: b.item.event.id },
        ),
      );
      const revealedKeys: string[] = [];
      for (const row of pooled.slice(0, Math.max(0, limit))) {
        row.sortAt = { createdAt: row.item.event.created_at, id: row.item.event.id };
        revealed.push(row);
        revealedKeys.push(row.key);
      }
      if (revealedKeys.length > 0) revealed.sort((a, b) => compareNewestFirst(a.sortAt!, b.sortAt!));
      return revealedKeys;
    },

    revealedCount: () => revealed.length,
    pooledCount: () => rows.size - revealed.length,

    snapshot() {
      return {
        notifications: revealed.map((row) => row.item),
        stats: { ...stats },
        profiles: { ...profiles },
        quoted: { ...quoted },
      };
    },
  };
}
