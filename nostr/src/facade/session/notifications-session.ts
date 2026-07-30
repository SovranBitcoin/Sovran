import type { NostrTier } from '@sovranbitcoin/schemas';
import type { TierOutcome } from '../../tiers';
import { combineSignals } from '../../timeout';
import { nostrLog } from '../../log';
import type { NostrEntityCache } from '../cache/entity-cache';
import type { NaggFeedEvent } from '../../map/feed';
import type { NostrCursor } from '@sovranbitcoin/schemas';
import type {
  NotificationItem,
  NotificationsBundle,
  NotificationsRequest,
  ResolvedNotifications,
} from '../notifications';
import { createNotificationsMerger } from './notifications-merger';
import type { Scheduler } from './surface-session';
import type { SortKey } from './page-buffer';

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

export type NotificationsSessionOptions = {
  request: NotificationsRequest;
  sources: ReadonlyArray<NotificationsSessionSource>;
  liveSubscribe?: (
    request: NotificationsRequest,
    since: SortKey | undefined,
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
  /** Fan out to non-exhausted sources, then reveal fetched + pooled rows. */
  loadMore(): Promise<ResolvedNotifications>;
  snapshot(): ResolvedNotifications;
  /** Any source not exhausted, or pooled rows awaiting an artificial page. */
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

  const merger = createNotificationsMerger();
  const controller = new AbortController();
  const listeners = new Set<() => void>();
  const per = new Map<NostrTier, { cursor: NostrCursor; exhausted: boolean }>();
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
      signal: combineSignals(options.request.signal, controller.signal),
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
      newest ? { createdAt: newest.created_at, id: newest.id } : undefined,
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
    for (const state of per.values()) if (!state.exhausted) return true;
    return false;
  }

  async function firstPage(): Promise<ResolvedNotifications> {
    let answeredCount = 0;
    const attempts = options.sources.map(async (source) => {
      const outcome = await source.fetch(sourceRequest(options.request.cursor ?? null));
      if (closed) return;
      if (outcome.kind === 'answered') {
        answeredCount += 1;
        trackBest(source.tier);
        per.set(source.tier, {
          cursor: outcome.value.cursor,
          exhausted: outcome.value.cursor === null,
        });
        absorb(source.tier, outcome.value);
      } else {
        per.set(source.tier, { cursor: null, exhausted: true });
      }
      nostrLog.debug('nostr.notifications.session.source', {
        tier: source.tier,
        outcome: outcome.kind,
      });
    });
    const allSettled = Promise.allSettled(attempts).then(() => undefined);
    // Paint gate: all settled, or the cap — but never paint EMPTY while
    // sources are still pending; the cap defers to the first answer instead.
    await new Promise<void>((resolve) => {
      let done = false;
      let capExpired = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        cancelCap();
        resolve();
      };
      const cancelCap = scheduleAfter(capMs, () => {
        capExpired = true;
        if (answeredCount > 0) finish();
      });
      for (const attempt of attempts) {
        void attempt.then(() => {
          if (capExpired && answeredCount > 0) finish();
        });
      }
      void allSettled.then(finish);
    });
    painted = true;
    merger.reveal(pageSize);
    startLive();
    startPrimalRepoll();
    return snapshot();
  }

  async function loadMore(): Promise<ResolvedNotifications> {
    const live = options.sources.filter((s) => per.get(s.tier)?.exhausted === false);
    await Promise.allSettled(
      live.map(async (source) => {
        const state = per.get(source.tier)!;
        const outcome = await source.fetch(sourceRequest(state.cursor));
        if (closed) return;
        if (outcome.kind !== 'answered') {
          state.exhausted = true;
          return;
        }
        const next = outcome.value.cursor;
        // Strict-advance guard: a cursor that doesn't move strictly older
        // marks the source exhausted (kills the multi-cursor loop failure).
        const advanced =
          !!next && (!state.cursor || next.createdAt < state.cursor.createdAt);
        if (advanced) state.cursor = next;
        state.exhausted = !advanced;
        absorb(source.tier, outcome.value);
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
