import type { NotificationSortKey } from "../notifications";
import type { NostrTier } from '@sovranbitcoin/schemas';
import type { TierOutcome } from '../../tiers';
import { combineSignals } from '../../timeout';
import { nostrLog } from '../../log';
import type { NostrEntityCache } from '../cache/entity-cache';
import type { NaggFeedEvent } from '../../map/feed';
import type { NostrCursor } from '@sovranbitcoin/schemas';
import type { FeedLaneState } from '../feed-pager';
import type {
  NotificationItem,
  NotificationsBundle,
  NotificationsRequest,
  ResolvedNotifications,
} from '../notifications';
import { createNotificationsMerger } from './notifications-merger';
type Scheduler = (flush: () => void) => () => void;

// ---------------------------------------------------------------------------
// Notifications session — the one facade surface that fans out CONCURRENTLY.
//
// Every source that implements `notifications` is opened at once: nagg may
// lack history (read-model floors, wipes), so redundancy is the point — the
// sequential "best tier that works" engine is the wrong shape here. The
// merger unifies the answers into one page keyed by dedupe identity; the
// session adds time: a bounded first-paint gate, per-source pagination, a
// relay live stream and a Primal re-poll that keep feeding the same
// idempotent absorb path after paint (the DM transport's live+poll idiom).
//
// No-content-shift contract: after the first paint, in-place row updates
// (count bumps, shape upgrades) notify subscribers; genuinely NEW rows pool
// until the next loadMore()/refresh — the page-boundary reveal the app's list
// can absorb without shifting.
// ---------------------------------------------------------------------------

export type NotificationsSessionSource = {
  tier: NostrTier;
  fetch: (request: NotificationsRequest) => Promise<TierOutcome<NotificationsBundle>>;
};

/**
 * Where one source stands in paging. The pager's states (`FeedLaneState`)
 * name the same things here, plus the two only a concurrent first page has.
 */
type SourceState =
  /** Its first page has not answered yet. */
  | { state: 'pending' }
  /** Older pages are asked for from `cursor`. */
  | { state: Extract<FeedLaneState, 'ready'>; cursor: NonNullable<NostrCursor> }
  /** The last older page failed; the next loadMore asks again from `cursor`. */
  | { state: Extract<FeedLaneState, 'backoff'>; cursor: NonNullable<NostrCursor> }
  /** The end of its history: no cursor, or one that did not move older. */
  | { state: Extract<FeedLaneState, 'exhausted'> }
  /** It cannot serve notifications or older pages. */
  | { state: Extract<FeedLaneState, 'unsupported'> }
  /**
   * Its first page failed. QUIRK (F221): read as no history and not asked
   * again until a refresh; asking again would fetch its newest rows, which the
   * next reveal sorts in above rows already on screen.
   */
  | { state: 'failed-first-page' };

/** The state a source moves to when `outcome` answers the page it was asked for. */
function afterPage(
  current: SourceState,
  outcome: TierOutcome<NotificationsBundle>,
): SourceState {
  switch (current.state) {
    case 'pending':
      if (outcome.kind === 'failed') return { state: 'failed-first-page' };
      if (outcome.kind === 'unsupported') return { state: 'unsupported' };
      return outcome.value.cursor
        ? { state: 'ready', cursor: outcome.value.cursor }
        : { state: 'exhausted' };
    case 'ready':
    case 'backoff': {
      // A failed page (timeout, network, a 5xx) says nothing about the end of
      // history: keep the cursor, as the feed pager does.
      if (outcome.kind === 'failed') return { state: 'backoff', cursor: current.cursor };
      if (outcome.kind === 'unsupported') return { state: 'unsupported' };
      const next = outcome.value.cursor;
      // Strict-advance guard: a cursor that does not move strictly older ends
      // the source (kills the multi-cursor loop failure).
      return next && next.createdAt < current.cursor.createdAt
        ? { state: 'ready', cursor: next }
        : { state: 'exhausted' };
    }
    case 'exhausted':
    case 'unsupported':
    case 'failed-first-page':
      return current;
    default: {
      const unreachable: never = current;
      return unreachable;
    }
  }
}

/** The cursor to ask for the next older page from, or null when the source is not asked. */
function olderPageCursor(source: SourceState): NonNullable<NostrCursor> | null {
  switch (source.state) {
    case 'ready':
    case 'backoff':
      return source.cursor;
    case 'pending':
    case 'exhausted':
    case 'unsupported':
    case 'failed-first-page':
      return null;
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}

export type NotificationsSessionOptions = {
  request: NotificationsRequest;
  /** Log-only correlation id stamped on this session's `nostr.notifications.session.*` events. */
  readId?: string;
  sources: ReadonlyArray<NotificationsSessionSource>;
  liveSubscribe?: (
    request: NotificationsRequest,
    since: NotificationSortKey | undefined,
    onItems: (items: readonly NotificationItem[]) => void,
  ) => () => void;
  cache?: NostrEntityCache;
  /** Page size for reveals and per-source fetches (default 50). */
  pageSize?: number;
  /** First-paint gate: render at all-settled or this cap — whichever first. */
  firstPaintCapMs?: number;
  /** Per-source timeout override (default 10s, not the 30s transport default). */
  sourceTimeoutMs?: number;
  /** Primal re-poll interval (default 60s). */
  primalRepollMs?: number;
  /** Live-batch conflation settle (default 50ms), injectable for tests. */
  schedule?: Scheduler;
  /** Timer seam for the paint cap + re-poll, injectable for tests. */
  scheduleAfter?: (ms: number, fire: () => void) => () => void;
};

export interface NotificationsSession {
  /** Fetch all sources concurrently; resolves at the paint gate with page 0. */
  firstPage(): Promise<ResolvedNotifications>;
  /** Fan out to sources that are ready or in backoff, then reveal fetched + pooled rows. */
  loadMore(): Promise<ResolvedNotifications>;
  snapshot(): ResolvedNotifications;
  /** Any source ready or in backoff, or pooled rows awaiting an artificial page. */
  hasMore(): boolean;
  /** Pooled new rows not yet revealed. */
  pendingCount(): number;
  /** Fires on in-place row updates and pool-count changes — never new rows. */
  subscribe(listener: () => void): () => void;
  close(): void;
}

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_FIRST_PAINT_CAP_MS = 400;
const DEFAULT_SOURCE_TIMEOUT_MS = 10_000;
const DEFAULT_PRIMAL_REPOLL_MS = 60_000;
const DEFAULT_SETTLE_MS = 50;

const defaultSchedule: Scheduler = (flush) => {
  const timer = setTimeout(flush, DEFAULT_SETTLE_MS);
  return () => clearTimeout(timer);
};

export function createNotificationsSession(
  options: NotificationsSessionOptions,
): NotificationsSession {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const capMs = options.firstPaintCapMs ?? DEFAULT_FIRST_PAINT_CAP_MS;
  const timeoutMs = options.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
  const repollMs = options.primalRepollMs ?? DEFAULT_PRIMAL_REPOLL_MS;
  const schedule = options.schedule ?? defaultSchedule;
  const scheduleAfter =
    options.scheduleAfter ??
    ((ms: number, fire: () => void) => {
      const timer = setTimeout(fire, ms);
      return () => clearTimeout(timer);
    });

  const readId = options.readId ?? null;
  const merger = createNotificationsMerger();
  const controller = new AbortController();
  const signal = combineSignals(options.request.signal, controller.signal);
  const listeners = new Set<() => void>();
  const per = new Map<NostrTier, SourceState>(
    options.sources.map((source) => [source.tier, { state: 'pending' }]),
  );
  let painted = false;
  let closed = false;
  let bestRank: NostrTier | null = null;
  let unsubscribeLive: (() => void) | null = null;
  let cancelSettle: (() => void) | null = null;
  let cancelRepoll: (() => void) | null = null;
  let pendingLive: NotificationItem[] = [];

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function sourceRequest(cursor: NostrCursor): NotificationsRequest {
    return {
      ...options.request,
      limit: pageSize,
      ...(cursor ? { cursor } : {}),
      timeoutMs: options.request.timeoutMs ?? timeoutMs,
      signal,
    };
  }

  function writeThrough(tier: NostrTier, bundle: NotificationsBundle): void {
    if (!options.cache) return;
    const events: NaggFeedEvent[] = [];
    for (const item of bundle.itemsById.values()) if (item.event) events.push(item.event);
    events.push(...Object.values(bundle.quoted));
    options.cache.ingestNotes(events);
    options.cache.ingestNoteStats(bundle.stats, tier);
    options.cache.ingestProfileInfos(bundle.profiles, tier);
  }

  /** ONE idempotent ingest body for pages, live batches, and re-polls. */
  function absorb(tier: NostrTier, bundle: NotificationsBundle): { created: number } {
    const { updated, created } = merger.ingest(tier, [...bundle.itemsById.values()]);
    merger.mergeEntities(tier, bundle);
    writeThrough(tier, bundle);
    if (!painted) return { created: created.length };
    if (merger.revealedCount() === 0 && created.length > 0) {
      // Replacing an empty state is not a scroll shift — promote directly.
      merger.reveal(pageSize);
      notify();
      return { created: created.length };
    }
    if (updated.length > 0 || created.length > 0) notify();
    return { created: created.length };
  }

  function absorbLiveItems(items: readonly NotificationItem[]): void {
    const { updated, created } = merger.ingest('relay', items);
    if (!painted) return;
    if (merger.revealedCount() === 0 && created.length > 0) {
      merger.reveal(pageSize);
      notify();
      return;
    }
    if (updated.length > 0 || created.length > 0) notify();
  }

  function startLive(): void {
    if (!options.liveSubscribe || unsubscribeLive || closed) return;
    const newest = merger.snapshot().notifications[0]?.event;
    unsubscribeLive = options.liveSubscribe(
      options.request,
      newest ? { createdAtSec: newest.created_at, id: newest.id } : undefined,
      (items) => {
        pendingLive.push(...items);
        if (!cancelSettle) {
          cancelSettle = schedule(() => {
            cancelSettle = null;
            const batch = pendingLive;
            pendingLive = [];
            absorbLiveItems(batch);
          });
        }
      },
    );
  }

  function startPrimalRepoll(): void {
    const primal = options.sources.find((s) => s.tier === 'primal');
    if (!primal || closed) return;
    const tick = async (): Promise<void> => {
      if (closed) return;
      const outcome = await primal.fetch(sourceRequest(null));
      if (!closed && outcome.kind === 'answered') absorb('primal', outcome.value);
      if (!closed) cancelRepoll = scheduleAfter(repollMs, () => void tick());
    };
    cancelRepoll = scheduleAfter(repollMs, () => void tick());
  }

  function trackBest(tier: NostrTier): void {
    const order: NostrTier[] = ['nagg', 'primal', 'relay'];
    if (!bestRank || order.indexOf(tier) < order.indexOf(bestRank)) bestRank = tier;
  }

  function snapshot(): ResolvedNotifications {
    const projected = merger.snapshot();
    const oldest = projected.notifications[projected.notifications.length - 1]?.event;
    return {
      tier: bestRank ?? 'relay',
      notifications: projected.notifications,
      grouped: true,
      stats: projected.stats,
      profiles: projected.profiles,
      quoted: projected.quoted,
      cursor: oldest ? { createdAt: oldest.created_at, id: oldest.id } : null,
      missingIds: [],
    };
  }

  function hasMore(): boolean {
    if (merger.pooledCount() > 0) return true;
    for (const state of per.values()) if (olderPageCursor(state)) return true;
    return false;
  }

  async function firstPage(): Promise<ResolvedNotifications> {
    const startedAt = Date.now();
    let answeredCount = 0;
    const answeredTiers: NostrTier[] = [];
    const attempts = options.sources.map(async (source) => {
      const outcome = await source.fetch(sourceRequest(options.request.cursor ?? null));
      if (closed) return;
      const next = afterPage({ state: 'pending' }, outcome);
      per.set(source.tier, next);
      if (outcome.kind === 'answered') {
        answeredCount += 1;
        answeredTiers.push(source.tier);
        trackBest(source.tier);
        absorb(source.tier, outcome.value);
      }
      nostrLog.debug('nostr.notifications.session.source', {
        readId,
        tier: source.tier,
        outcome: outcome.kind,
        state: next.state,
        elapsedMs: Date.now() - startedAt,
      });
    });
    const allSettled = Promise.allSettled(attempts).then(() => undefined);
    // Paint gate: all settled, or the cap — but never paint EMPTY while
    // sources are still pending; the cap defers to the first answer instead.
    await new Promise<void>((resolve) => {
      let done = false;
      let capExpired = false;
      const finish = (gate: 'capMs' | 'allSettled'): void => {
        if (done) return;
        done = true;
        cancelCap();
        // The first-paint gate made visible: which tiers had answered when the
        // page was released, and how long the viewer waited for it.
        nostrLog.info('nostr.notifications.session.paint', {
          readId,
          gate,
          answered: [...answeredTiers],
          pending: options.sources
            .map((s) => s.tier)
            .filter((tier) => per.get(tier)?.state === 'pending'),
          count: merger.revealedCount() + merger.pooledCount(),
          elapsedMs: Date.now() - startedAt,
        });
        resolve();
      };
      const cancelCap = scheduleAfter(capMs, () => {
        capExpired = true;
        if (answeredCount > 0) finish('capMs');
      });
      for (const attempt of attempts) {
        void attempt.then(() => {
          if (capExpired && answeredCount > 0) finish('capMs');
        });
      }
      void allSettled.then(() => finish('allSettled'));
    });
    painted = true;
    merger.reveal(pageSize);
    startLive();
    startPrimalRepoll();
    return snapshot();
  }

  async function loadMore(): Promise<ResolvedNotifications> {
    await Promise.allSettled(
      options.sources.map(async (source) => {
        const asked = per.get(source.tier);
        const cursor = asked && olderPageCursor(asked);
        if (!asked || !cursor) return;
        const outcome = await source.fetch(sourceRequest(cursor));
        if (closed) return;
        // An overlapping loadMore may have moved the source on while this page
        // was in flight. Then the answer only shows this request was stale: it
        // says nothing about where the source's history ends, so its paging
        // stays as it is (its rows are still taken in).
        const now = per.get(source.tier) ?? asked;
        const from = olderPageCursor(now);
        if (from && from.createdAt === cursor.createdAt && from.id === cursor.id)
          per.set(source.tier, afterPage(now, outcome));
        if (outcome.kind === 'answered') absorb(source.tier, outcome.value);
      }),
    );
    merger.reveal(pageSize);
    notify();
    return snapshot();
  }

  return {
    firstPage,
    loadMore,
    snapshot,
    hasMore,
    pendingCount: () => merger.pooledCount(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      controller.abort();
      unsubscribeLive?.();
      unsubscribeLive = null;
      cancelSettle?.();
      cancelSettle = null;
      cancelRepoll?.();
      cancelRepoll = null;
      pendingLive = [];
      listeners.clear();
    },
  };
}
