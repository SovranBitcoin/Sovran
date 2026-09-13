import { describe, test, expect, vi } from 'vitest';
import { resolveAllTiers, answered, unsupported, failed, type TierCandidate } from '../src/tiers';
import type { NaggError } from '../src/errors';
import { setNostrLogger } from '../src/log';

const networkError: NaggError = { type: 'network', message: 'boom', cause: new Error('boom') };

type Tier = 'nagg' | 'primal' | 'relay';

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
    fire(ms: number): void {
      for (const entry of [...pending]) {
        if (entry.cancelled || entry.ms !== ms) continue;
        entry.cancelled = true;
        entry.fire();
      }
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function candidate(tier: Tier, attempt: () => Promise<any>): TierCandidate<string[]> {
  return { tier, attempt };
}

const listOptions = (timers: ReturnType<typeof manualTimers>, extra: Partial<Parameters<typeof resolveAllTiers<string[]>>[1]> = {}) => ({
  count: (v: string[]) => v.length,
  // Append-only union: earlier rows keep their index.
  merge: (acc: string[] | undefined, next: string[]) => [...(acc ?? []), ...next.filter((x) => !(acc ?? []).includes(x))],
  scheduleAfter: timers.scheduleAfter,
  ...extra,
});

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('resolveAllTiers — aggregate engine', () => {
  test('paints at minItems before the cap and keeps merging through onUpdate', async () => {
    const timers = manualTimers();
    const relay = deferred<any>();
    const updates: Array<{ sources: string[]; complete: boolean; value: string[] }> = [];
    const result = await resolveAllTiers<string[]>(
      [candidate('nagg', async () => answered(['a', 'b'])), candidate('relay', () => relay.promise)],
      listOptions(timers, {
        gate: { minItems: 2, capMs: 600 },
        onUpdate: (e) => updates.push({ sources: e.sources, complete: e.complete, value: e.value }),
      }),
    );
    const first = result._unsafeUnwrap();
    expect(first.value).toEqual(['a', 'b']);
    expect(first.tier).toBe('nagg');
    expect(first.sources).toEqual(['nagg']);
    expect(first.pending).toEqual(['relay']);
    expect(first.complete).toBe(false);
    expect(updates).toEqual([]);

    relay.resolve(answered(['b', 'c']));
    await flush();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ sources: ['nagg', 'relay'], complete: true, value: ['a', 'b', 'c'] });
  });

  test('cap with one answer paints partial; the later answer arrives complete', async () => {
    const timers = manualTimers();
    const primal = deferred<any>();
    const updates: string[][] = [];
    const pending = resolveAllTiers<string[]>(
      [candidate('nagg', async () => answered(['a'])), candidate('primal', () => primal.promise)],
      listOptions(timers, { gate: { minItems: 5, capMs: 600 }, onUpdate: (e) => updates.push(e.value) }),
    );
    await flush();
    timers.fire(600);
    const first = (await pending)._unsafeUnwrap();
    expect(first.value).toEqual(['a']);
    expect(first.complete).toBe(false);
    primal.resolve(answered(['z']));
    await flush();
    expect(updates).toEqual([['a', 'z']]);
  });

  test('the cap never paints empty while sources are pending; first answer paints instead', async () => {
    const timers = manualTimers();
    const nagg = deferred<any>();
    let resolved = false;
    const pending = resolveAllTiers<string[]>(
      [candidate('nagg', () => nagg.promise)],
      listOptions(timers, { gate: { minItems: 3, capMs: 100 } }),
    ).then((r) => {
      resolved = true;
      return r;
    });
    timers.fire(100);
    await flush();
    expect(resolved).toBe(false);
    nagg.resolve(answered(['only']));
    const result = (await pending)._unsafeUnwrap();
    expect(result.value).toEqual(['only']);
    expect(result.complete).toBe(true);
  });

  test('all failed → all_tiers_exhausted with the attempt trail', async () => {
    const timers = manualTimers();
    const result = await resolveAllTiers<string[]>(
      [candidate('nagg', async () => failed(networkError)), candidate('primal', async () => unsupported())],
      listOptions(timers),
    );
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe('all_tiers_exhausted');
    expect(error.attempts.map((a) => `${a.tier}=${a.outcome}`)).toEqual(['nagg=failed', 'primal=unsupported']);
  });

  test('a throwing attempt is folded into failed, never a rejection', async () => {
    const timers = manualTimers();
    const result = await resolveAllTiers<string[]>(
      [candidate('nagg', async () => { throw new Error('kaboom'); }), candidate('relay', async () => answered(['r']))],
      listOptions(timers),
    );
    const value = result._unsafeUnwrap();
    expect(value.value).toEqual(['r']);
    expect(value.degraded).toBe(true);
    expect(value.attempts[0]).toMatchObject({ tier: 'nagg', outcome: 'failed' });
  });

  test('a hung source is recorded failed at sourceTimeoutMs so complete still arrives', async () => {
    const timers = manualTimers();
    const hung = deferred<any>();
    const updates: Array<{ complete: boolean; degraded: boolean }> = [];
    const result = await resolveAllTiers<string[]>(
      [candidate('nagg', async () => answered(['a'])), candidate('relay', () => hung.promise)],
      listOptions(timers, {
        gate: { minItems: 1 },
        sourceTimeoutMs: 5000,
        onUpdate: (e) => updates.push({ complete: e.complete, degraded: e.degraded }),
      }),
    );
    expect(result._unsafeUnwrap().pending).toEqual(['relay']);
    timers.fire(5000);
    await flush();
    expect(updates).toEqual([{ complete: true, degraded: true }]);
    // A late answer from the timed-out source is ignored.
    hung.resolve(answered(['late']));
    await flush();
    expect(updates).toHaveLength(1);
  });

  test('tier is the best rank among answerers; degraded only on failed, not unsupported', async () => {
    const timers = manualTimers();
    const result = await resolveAllTiers<string[]>(
      [
        candidate('nagg', async () => unsupported()),
        candidate('primal', async () => answered(['p'])),
        candidate('relay', async () => answered(['r'])),
      ],
      listOptions(timers, { gate: { requireAll: true } }),
    );
    const value = result._unsafeUnwrap();
    expect(value.tier).toBe('primal');
    expect(value.sources).toEqual(['primal', 'relay']);
    expect(value.degraded).toBe(false);
    expect(value.complete).toBe(true);
  });

  test('zero candidates → exhausted immediately', async () => {
    const timers = manualTimers();
    const result = await resolveAllTiers<string[]>([], listOptions(timers));
    expect(result._unsafeUnwrapErr().message).toBe('no tiers were offered for this read');
  });

  test('first-paint row order is preserved by later merges (append, never reorder)', async () => {
    const timers = manualTimers();
    const relay = deferred<any>();
    const updates: string[][] = [];
    const first = (
      await resolveAllTiers<string[]>(
        [candidate('nagg', async () => answered(['x', 'y'])), candidate('relay', () => relay.promise)],
        listOptions(timers, { gate: { minItems: 1 }, onUpdate: (e) => updates.push(e.value) }),
      )
    )._unsafeUnwrap();
    relay.resolve(answered(['y', 'w', 'x']));
    await flush();
    expect(first.value).toEqual(['x', 'y']);
    expect(updates[0]!.slice(0, 2)).toEqual(['x', 'y']);
    expect(updates[0]).toEqual(['x', 'y', 'w']);
  });

  test('logs the aggregate trail with readId/surface', async () => {
    const timers = manualTimers();
    const events: string[] = [];
    const sink = {
      debug: (event: string, data?: Record<string, unknown>) => events.push(`${event}:${data?.readId}`),
      info: (event: string, data?: Record<string, unknown>) => events.push(`${event}:${data?.readId}`),
      warn: (event: string, data?: Record<string, unknown>) => events.push(`${event}:${data?.readId}`),
    };
    setNostrLogger(sink);
    try {
      await resolveAllTiers<string[]>(
        [candidate('nagg', async () => answered(['a']))],
        listOptions(timers, { readId: 'r9', surface: 'profiles' }),
      );
    } finally {
      setNostrLogger(null);
    }
    expect(events).toEqual([
      'nostr.tier.aggregate.start:r9',
      'nostr.tier.aggregate.source:r9',
      'nostr.tier.aggregate.settled:r9',
      'nostr.tier.aggregate.paint:r9',
    ]);
    vi.restoreAllMocks();
  });
});
