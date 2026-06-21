import { describe, it, expect, vi } from 'vitest';
import {
  createSurfaceSession,
  type PageBound,
  type SortKey,
} from '../src/facade/session/surface-session';

type Item = { id: string; createdAt: number };
const keyOf = (i: Item): SortKey => ({ id: i.id, createdAt: i.createdAt });
const ids = (items: ReadonlyArray<Item>) => items.map((i) => i.id);

/** A manual settle scheduler: the test fires the flush by hand. */
function manualScheduler() {
  let pending: (() => void) | null = null;
  return {
    schedule: (flush: () => void) => {
      pending = flush;
      return () => {
        pending = null;
      };
    },
    settle: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
    get armed() {
      return pending !== null;
    },
  };
}

describe('SurfaceSession pagination', () => {
  it('firstPage seeds newest-first; loadOlder fetches by the oldest bound', async () => {
    const calls: PageBound[] = [];
    const fetchPage = async (bound: PageBound): Promise<readonly Item[]> => {
      calls.push(bound);
      return bound.until
        ? [{ id: 'z', createdAt: 5 }]
        : [
            { id: 'a', createdAt: 10 },
            { id: 'c', createdAt: 30 },
            { id: 'b', createdAt: 20 },
          ];
    };
    const session = createSurfaceSession<Item>({ keyOf, fetchPage });

    expect(ids(await session.firstPage())).toEqual(['c', 'b', 'a']);
    expect(session.pendingNew()).toBe(0); // no listener configured

    const older = await session.loadOlder();
    expect(ids(older)).toEqual(['c', 'b', 'a', 'z']);
    expect(calls[1].until).toEqual({ id: 'a', createdAt: 10 }); // bounded by oldest
  });
});

describe('SurfaceSession live listener', () => {
  it('conflates a burst into one offer; withholds new behind pendingNew; loadNew reveals', async () => {
    const sched = manualScheduler();
    const live: { onItems: ((items: readonly Item[]) => void) | null } = { onItems: null };
    let sinceAtSubscribe: SortKey | undefined;

    const session = createSurfaceSession<Item>({
      keyOf,
      fetchPage: async () => [{ id: 'a', createdAt: 10 }],
      liveSubscribe: (since, onItems) => {
        sinceAtSubscribe = since;
        live.onItems = onItems;
        return () => {
          live.onItems = null;
        };
      },
      schedule: sched.schedule,
    });

    await session.firstPage();
    expect(sinceAtSubscribe).toEqual({ id: 'a', createdAt: 10 }); // listener since = newest

    const onChange = vi.fn();
    session.subscribe(onChange);

    // Two bursts before the settle fires -> conflated into one offerNew.
    live.onItems?.([{ id: 'b', createdAt: 20 }]);
    live.onItems?.([{ id: 'c', createdAt: 30 }, { id: 'old', createdAt: 5 }]);
    expect(session.pendingNew()).toBe(0); // nothing applied until settle
    expect(sched.armed).toBe(true);

    sched.settle();
    expect(session.pendingNew()).toBe(2); // b + c (old is below cutoff)
    expect(ids(session.revealed)).toEqual(['a']); // not injected on screen
    expect(onChange).toHaveBeenCalledTimes(1); // one notify for the conflated batch

    const revealed = session.loadNew();
    expect(ids(revealed)).toEqual(['c', 'b', 'a']);
    expect(session.pendingNew()).toBe(0);
  });

  it('close() stops the listener and cancels a pending settle', async () => {
    const sched = manualScheduler();
    const live: { onItems: ((items: readonly Item[]) => void) | null } = { onItems: null };
    let unsubscribed = false;
    const session = createSurfaceSession<Item>({
      keyOf,
      fetchPage: async () => [{ id: 'a', createdAt: 10 }],
      liveSubscribe: (_since, onItems) => {
        live.onItems = onItems;
        return () => {
          unsubscribed = true;
        };
      },
      schedule: sched.schedule,
    });
    await session.firstPage();
    live.onItems?.([{ id: 'b', createdAt: 20 }]);
    expect(sched.armed).toBe(true);
    session.close();
    expect(unsubscribed).toBe(true);
    expect(sched.armed).toBe(false); // settle cancelled
  });
});
