import { describe, expect, it } from 'vitest';
import {
  createNotificationsSession,
  type NotificationsSessionSource,
} from '../src/facade/session/notifications-session';
import { answered, failed, unsupported, type TierOutcome } from '../src/tiers';
import type {
  NotificationItem,
  NotificationsBundle,
  NotificationsRequest,
} from '../src/facade/notifications';
import type { NaggFeedEvent } from '../src/map/feed';
import type { NostrTier } from '@sovranbitcoin/schemas';

const ME = 'f'.repeat(64);
const TARGET = 'a'.repeat(64);

function ev(id: string, pubkey: string, kind: number, created_at: number): NaggFeedEvent {
  return { id, pubkey, kind, content: '', tags: [], created_at };
}

function flatItem(id: string, pubkey: string, reason: string, created_at: number): NotificationItem {
  const kind = reason === 'reaction' ? 7 : 1;
  return { event: ev(id, pubkey, kind, created_at), reason, actorVertexScore: 0, targetEventId: TARGET };
}

function bundle(items: NotificationItem[], cursor?: { createdAt: number; id: string } | null): NotificationsBundle {
  const itemsById = new Map(items.map((i) => [i.event.id, i]));
  return {
    itemsById,
    manifest: { orderBy: 'created_at', elements: items.map((i) => i.event.id) },
    grouped: false,
    stats: {},
    profiles: {},
    quoted: {},
    cursor: cursor === undefined ? (items.length ? { createdAt: items[items.length - 1]!.event.created_at, id: items[items.length - 1]!.event.id } : null) : cursor,
  };
}

/** Deterministic timer seam: fire() manually by registered order. */
function manualTimers() {
  const pending: Array<{ ms: number; fire: () => void; cancelled: boolean }> = [];
  return {
    scheduleAfter(ms: number, fire: () => void): () => void {
      const entry = { ms, fire, cancelled: false };
      pending.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    fireAll(msFilter?: number): void {
      for (const entry of [...pending]) {
        if (entry.cancelled) continue;
        if (msFilter !== undefined && entry.ms !== msFilter) continue;
        entry.cancelled = true;
        entry.fire();
      }
    },
  };
}

function source(
  tier: NostrTier,
  pages: Array<TierOutcome<NotificationsBundle>> | ((req: NotificationsRequest) => Promise<TierOutcome<NotificationsBundle>>),
): NotificationsSessionSource & { requests: NotificationsRequest[] } {
  const requests: NotificationsRequest[] = [];
  let index = 0;
  const fetch =
    typeof pages === 'function'
      ? (req: NotificationsRequest) => {
          requests.push(req);
          return pages(req);
        }
      : (req: NotificationsRequest) => {
          requests.push(req);
          const outcome = pages[Math.min(index, pages.length - 1)]!;
          index += 1;
          return Promise.resolve(outcome);
        };
  return { tier, fetch, requests };
}

const REQUEST: NotificationsRequest = { viewerPubkey: ME, tab: 'ALL' };

describe('notifications session', () => {
  it('merges all sources into page 0 when everyone answers before the cap', async () => {
    const nagg = source('nagg', [answered(bundle([flatItem('n1', 'alice', 'reply', 30)]))]);
    const relay = source('relay', [answered(bundle([flatItem('r1', 'bob', 'reaction', 20)]))]);
    const timers = manualTimers();
    const session = createNotificationsSession({
      request: REQUEST,
      sources: [nagg, relay],
      scheduleAfter: timers.scheduleAfter,
    });
    const page = await session.firstPage();
    expect(page.notifications).toHaveLength(2);
    expect(page.tier).toBe('nagg');
    session.close();
  });

  it('paints at the cap with what arrived; a late source upgrades in place and pools new keys', async () => {
    let resolveNagg!: (o: TierOutcome<NotificationsBundle>) => void;
    let naggCalls = 0;
    const nagg = source('nagg', () => {
      naggCalls += 1;
      if (naggCalls === 1) return new Promise((resolve) => (resolveNagg = resolve));
      return Promise.resolve(answered(bundle([], null)));
    });
    const relay = source('relay', [answered(bundle([flatItem('r1', 'bob', 'reaction', 20)]))]);
    const timers = manualTimers();
    const session = createNotificationsSession({
      request: REQUEST,
      sources: [nagg, relay],
      scheduleAfter: timers.scheduleAfter,
    });
    const paint = session.firstPage();
    await Promise.resolve();
    timers.fireAll(400);
    const page = await paint;
    expect(page.notifications).toHaveLength(1);

    let notified = 0;
    session.subscribe(() => (notified += 1));
    resolveNagg(
      answered(
        bundle([
          flatItem('n1', 'carol', 'reaction', 25), // same key → in-place merge
          flatItem('n2', 'dave', 'reply', 40), // new key → pooled
        ]),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(notified).toBeGreaterThan(0);
    expect(session.snapshot().notifications).toHaveLength(1); // no new rows mid-page
    expect(session.pendingCount()).toBe(1);
    const more = await session.loadMore();
    expect(more.notifications).toHaveLength(2); // pooled key revealed at the boundary
    session.close();
  });

  it('defers an empty paint past the cap until the first answer', async () => {
    let resolveRelay!: (o: TierOutcome<NotificationsBundle>) => void;
    const relay = source('relay', () => new Promise((resolve) => (resolveRelay = resolve)));
    const timers = manualTimers();
    const session = createNotificationsSession({
      request: REQUEST,
      sources: [relay],
      scheduleAfter: timers.scheduleAfter,
    });
    const paint = session.firstPage();
    await Promise.resolve();
    timers.fireAll(400); // cap fires with zero answers → must NOT resolve yet
    let resolved = false;
    void paint.then(() => (resolved = true));
    await Promise.resolve();
    expect(resolved).toBe(false);
    resolveRelay(answered(bundle([flatItem('r1', 'bob', 'reaction', 20)])));
    const page = await paint;
    expect(page.notifications).toHaveLength(1);
    session.close();
  });

  it('paginates per-source cursors and marks a non-advancing source exhausted', async () => {
    const nagg = source('nagg', [
      answered(bundle([flatItem('n1', 'alice', 'reply', 30)], { createdAt: 30, id: 'n1' })),
      answered(bundle([flatItem('n2', 'bob', 'reply', 10)], { createdAt: 10, id: 'n2' })),
    ]);
    const relay = source('relay', [
      answered(bundle([flatItem('r1', 'carol', 'reply', 25)], { createdAt: 25, id: 'r1' })),
      // Cursor does NOT advance (same createdAt) → source exhausted.
      answered(bundle([], { createdAt: 25, id: 'r1' })),
      answered(bundle([], { createdAt: 25, id: 'r1' })),
    ]);
    const timers = manualTimers();
    const session = createNotificationsSession({
      request: REQUEST,
      sources: [nagg, relay],
      scheduleAfter: timers.scheduleAfter,
    });
    await session.firstPage();
    await session.loadMore();
    expect(nagg.requests[1]?.cursor).toEqual({ createdAt: 30, id: 'n1' });
    expect(relay.requests[1]?.cursor).toEqual({ createdAt: 25, id: 'r1' });
    await session.loadMore();
    // relay was exhausted by the non-advancing page; only nagg is refetched.
    expect(relay.requests).toHaveLength(2);
    session.close();
  });

  it('serves an artificial pool-only page when all sources are exhausted', async () => {
    const nagg = source('nagg', [
      answered(bundle([flatItem('n1', 'alice', 'reply', 30)], null)), // null cursor → exhausted
    ]);
    const timers = manualTimers();
    const session = createNotificationsSession({
      request: REQUEST,
      sources: [nagg],
      scheduleAfter: timers.scheduleAfter,
      liveSubscribe: (_req, _since, onItems) => {
        queueMicrotask(() => onItems([flatItem('live1', 'eve', 'reply', 50)]));
        return () => {};
      },
      schedule: (flush) => {
        flush();
        return () => {};
      },
    });
    await session.firstPage();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.pendingCount()).toBe(1);
    expect(session.hasMore()).toBe(true); // pool keeps hasMore alive
    const more = await session.loadMore(); // no live sources → pool-only reveal
    expect(more.notifications.map((n) => n.event.id)).toContain('live1');
    expect(nagg.requests).toHaveLength(1); // no refetch of an exhausted source
    session.close();
  });

  it('failed and unsupported sources leave the others serving', async () => {
    const nagg = source('nagg', [failed({ type: 'network', message: 'down', cause: undefined })]);
    const primal = source('primal', [unsupported()]);
    const relay = source('relay', [answered(bundle([flatItem('r1', 'bob', 'reaction', 20)]))]);
    const timers = manualTimers();
    const session = createNotificationsSession({
      request: REQUEST,
      sources: [nagg, primal, relay],
      scheduleAfter: timers.scheduleAfter,
    });
    const page = await session.firstPage();
    expect(page.notifications).toHaveLength(1);
    expect(page.tier).toBe('relay');
    session.close();
  });

  it('close() cancels the live stream, settle, and re-poll', async () => {
    let unsubscribed = 0;
    const primal = source('primal', [answered(bundle([flatItem('p1', 'alice', 'reply', 20)]))]);
    const timers = manualTimers();
    const session = createNotificationsSession({
      request: REQUEST,
      sources: [primal],
      scheduleAfter: timers.scheduleAfter,
      liveSubscribe: () => () => {
        unsubscribed += 1;
      },
    });
    await session.firstPage();
    session.close();
    expect(unsubscribed).toBe(1);
    // Firing the (cancelled) repoll timer must not fetch again.
    timers.fireAll();
    expect(primal.requests).toHaveLength(1);
  });
});
