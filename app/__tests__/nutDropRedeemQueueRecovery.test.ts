/**
 * @jest-environment node
 *
 * The Nut Drop redeem queue reading back a copy set aside at
 * `nut-drop-redeem-queue:unreadable` by a build whose reader turned the queue
 * down (one entry over the old read limits). The copy holds queued ecash.
 *
 * The real store runs over an in-memory disk keyed per account, as
 * `profileScopedStorage` keys it; "next launch" loads a fresh copy of the
 * store module from the same disk. Only the storage adapter is replaced, so a
 * save or removal can be made to fail.
 */

import { meshTokenDedupeKey } from 'wallet';

import type { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';

type Store = typeof useNutDropRedeemQueueStore;
type Entry = Record<string, unknown> & { token: string };

interface MockStorage {
  disk: Map<string, string>;
  account: { active: string };
  /** Runs before each save or removal reaches the disk; throw to fail it. */
  faults: {
    beforeSet: (key: string) => void | 'drop';
    beforeRemove: (key: string) => void;
  };
}

jest.mock('@/shared/stores/global/profileStore', () => ({
  activePubkey: () =>
    jest.requireMock<MockStorage>('@/shared/lib/cashu/profileScopedStorage').account.active,
}));
// The disk lives inside the mock: the store reads it while modules load.
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => {
  const disk = new Map<string, string>();
  const account = { active: 'a'.repeat(64) };
  const faults: {
    beforeSet: (name: string) => unknown;
    beforeRemove: (name: string) => unknown;
  } = { beforeSet: () => undefined, beforeRemove: () => undefined };
  const keyFor = (name: string) => `${name}:profile:${account.active}`;
  return {
    disk,
    account,
    faults,
    createProfileScopedStorage: () => ({
      getItem: async (name: string) => disk.get(keyFor(name)) ?? null,
      setItem: async (name: string, value: string) => {
        if (faults.beforeSet(keyFor(name)) === 'drop') return;
        disk.set(keyFor(name), value);
      },
      removeItem: async (name: string) => {
        faults.beforeRemove(keyFor(name));
        disk.delete(keyFor(name));
      },
    }),
  };
});

const mock = jest.requireMock<MockStorage>('@/shared/lib/cashu/profileScopedStorage');
const { disk, account, faults } = mock;

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const queueKey = (pubkey = A) => `nut-drop-redeem-queue:profile:${pubkey}`;
const sideKey = (pubkey = A) => `nut-drop-redeem-queue:unreadable:profile:${pubkey}`;

/** A queued entry as a release saved it. */
function entry(token: string, fields: Record<string, unknown> = {}): Entry {
  return {
    token,
    mintUrl: 'https://mint.example',
    amount: 8,
    unit: 'sat',
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    receivedAt: 1_790_000_000_000,
    ...fields,
  };
}

const byHash = (entries: Entry[]) =>
  Object.fromEntries(entries.map((e) => [meshTokenDedupeKey(e.token), e]));

/** The bytes zustand's persist writes, which the guard copies aside unchanged. */
const blob = (entries: Entry[]) =>
  JSON.stringify({ state: { byTokenHash: byHash(entries) }, version: 1 });

const savedQueue = (pubkey = A): Record<string, Entry> => {
  const raw = disk.get(queueKey(pubkey));
  return raw
    ? (JSON.parse(raw) as { state: { byTokenHash: Record<string, Entry> } }).state.byTokenHash
    : {};
};

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Load the queue store as a fresh app launch would, from the same disk. */
async function launch(): Promise<Store> {
  let store: Store | undefined;
  jest.isolateModules(() => {
    store = jest.requireActual<{ useNutDropRedeemQueueStore: Store }>(
      '@/shared/stores/profile/nutDropRedeemQueueStore'
    ).useNutDropRedeemQueueStore;
  });
  await settle();
  return store!;
}

// One entry in the copy is over 0.1.3's read limits: why it was set aside.
const overMint = `https://mint.example/${'m'.repeat(3000)}`;
const ONE = entry('cashuBrecoveredone', { amount: 1 });
const TWO = entry('cashuBrecoveredtwo', { amount: 2, mintUrl: overMint });
const THREE = entry('cashuBrecoveredthree', { amount: 3, status: 'untrusted-mint', attempts: 1 });
const COPY = [ONE, TWO, THREE];

const failSave = (): never => {
  throw new Error('disk full');
};

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  disk.clear();
  account.active = A;
  faults.beforeSet = () => undefined;
  faults.beforeRemove = () => undefined;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Nut Drop redeem queue recovering a copy set aside as unreadable', () => {
  it('merges every entry of the copy into an empty queue, then removes the copy', async () => {
    disk.set(sideKey(), blob(COPY));

    const store = await launch();

    expect(store.getState().byTokenHash).toEqual(byHash(COPY));
    expect(savedQueue()).toEqual(byHash(COPY));
    expect(disk.has(sideKey())).toBe(false);
  });

  it('keeps what the queue already holds and adds only what it lacks', async () => {
    // The queue moved on since the copy was made: TWO was redeemed, and a new
    // token arrived.
    const twoRedeemed = { ...TWO, status: 'redeemed', attempts: 1 };
    const FOUR = entry('cashuBnewsincecopy', { amount: 4 });
    disk.set(queueKey(), blob([twoRedeemed, FOUR]));
    disk.set(sideKey(), blob(COPY));

    const store = await launch();

    const expected = byHash([ONE, twoRedeemed, THREE, FOUR]);
    expect(store.getState().byTokenHash).toEqual(expected);
    expect(savedQueue()).toEqual(expected);
    expect(disk.has(sideKey())).toBe(false);
  });

  it('removes the copy only once the merged queue is on disk', async () => {
    disk.set(sideKey(), blob(COPY));
    const onDiskAtRemoval: Record<string, Entry>[] = [];
    faults.beforeRemove = (key) => {
      if (key === sideKey()) onDiskAtRemoval.push(savedQueue());
    };

    await launch();

    expect(onDiskAtRemoval).toEqual([byHash(COPY)]);
  });

  it.each([
    // Every save fails, the first included: nothing may be left unhandled.
    ['fails', () => failSave()],
    ['is dropped without an error', () => 'drop' as const],
  ])('keeps the copy when the save of the merged queue %s', async (_what, fault) => {
    disk.set(sideKey(), blob(COPY));
    let calls = 0;
    faults.beforeSet = (key) => {
      if (key !== queueKey()) return undefined;
      calls += 1;
      return fault();
    };

    await launch();

    expect(calls).toBeGreaterThanOrEqual(1);
    expect(disk.has(queueKey())).toBe(false);
    expect(disk.get(sideKey())).toBe(blob(COPY));

    // The next launch, with a working disk, finishes the job.
    faults.beforeSet = () => undefined;
    const store = await launch();
    expect(store.getState().byTokenHash).toEqual(byHash(COPY));
    expect(savedQueue()).toEqual(byHash(COPY));
    expect(disk.has(sideKey())).toBe(false);
  });

  it('after a kill between the save and the removal, adds nothing twice and then removes the copy', async () => {
    const FOUR = entry('cashuBnewsincecopy', { amount: 4 });
    disk.set(queueKey(), blob([FOUR]));
    disk.set(sideKey(), blob(COPY));
    faults.beforeRemove = (key) => {
      if (key === sideKey()) throw new Error('killed');
    };

    await launch();

    const merged = byHash([ONE, TWO, THREE, FOUR]);
    expect(savedQueue()).toEqual(merged);
    expect(disk.get(sideKey())).toBe(blob(COPY));

    faults.beforeRemove = () => undefined;
    const store = await launch();
    expect(store.getState().byTokenHash).toEqual(merged);
    expect(Object.keys(store.getState().byTokenHash)).toHaveLength(4);
    expect(savedQueue()).toEqual(merged);
    expect(disk.has(sideKey())).toBe(false);
  });

  it('does not bring back a token redeemed and pruned while its copy could not be removed', async () => {
    disk.set(sideKey(), blob(COPY));
    faults.beforeRemove = (key) => {
      if (key === sideKey()) throw new Error('killed');
    };
    const first = await launch();
    expect(savedQueue()).toEqual(byHash(COPY));
    expect(disk.get(sideKey())).toBe(blob(COPY));

    // ONE is redeemed and, being old, pruned: its record leaves the queue.
    const hashOne = meshTokenDedupeKey(ONE.token);
    first.setState((state) => {
      const { [hashOne]: _gone, ...rest } = state.byTokenHash;
      return { byTokenHash: rest };
    });
    await settle();
    expect(savedQueue()).toEqual(byHash([TWO, THREE]));

    faults.beforeRemove = () => undefined;
    const store = await launch();
    expect(store.getState().byTokenHash).toEqual(byHash([TWO, THREE]));
    expect(savedQueue()).toEqual(byHash([TWO, THREE]));
    expect(disk.has(sideKey())).toBe(false);
  });

  it('leaves a copy this release cannot read where it is', async () => {
    const FOUR = entry('cashuBnewsincecopy', { amount: 4 });
    disk.set(queueKey(), blob([FOUR]));
    // An entry with no token to redeem: the reader still turns the copy down.
    const unreadable = JSON.stringify({
      state: { byTokenHash: { ...byHash(COPY), ['c'.repeat(64)]: { ...ONE, token: '' } } },
      version: 1,
    });
    disk.set(sideKey(), unreadable);

    const store = await launch();
    store.getState().prune();
    await settle();

    expect(disk.get(sideKey())).toBe(unreadable);
    expect(store.getState().byTokenHash).toEqual(byHash([FOUR]));
    expect(savedQueue()).toEqual(byHash([FOUR]));
  });

  it('touches only the copy of the account it loaded for', async () => {
    const theirs = [entry('cashuBotheraccount', { amount: 9 })];
    disk.set(sideKey(B), blob(theirs));
    disk.set(sideKey(A), blob(COPY));

    const store = await launch();

    expect(store.getState().byTokenHash).toEqual(byHash(COPY));
    expect(savedQueue(A)).toEqual(byHash(COPY));
    expect(disk.has(sideKey(A))).toBe(false);
    expect(disk.get(sideKey(B))).toBe(blob(theirs));
    expect(disk.has(queueKey(B))).toBe(false);
  });

  it('leaves the copy when the account changes while it is read', async () => {
    disk.set(sideKey(A), blob(COPY));
    faults.beforeSet = () => undefined;
    // The copy is read under A; the account flips before it is merged.
    const realGet = disk.get.bind(disk);
    jest.spyOn(disk, 'get').mockImplementation((key: string) => {
      if (key === sideKey(A)) account.active = B;
      return realGet(key);
    });

    const store = await launch();

    expect(store.getState().byTokenHash).toEqual({});
    expect(disk.get(sideKey(A))).toBe(blob(COPY));
    expect(disk.has(queueKey(B))).toBe(false);
  });

  it('ends three launches in a row in the same state', async () => {
    const FOUR = entry('cashuBnewsincecopy', { amount: 4 });
    disk.set(queueKey(), blob([FOUR]));
    disk.set(sideKey(), blob(COPY));

    const states: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const store = await launch();
      states.push(
        JSON.stringify({
          memory: store.getState().byTokenHash,
          disk: Object.fromEntries([...disk].sort()),
        })
      );
    }

    expect(states[1]).toBe(states[0]);
    expect(states[2]).toBe(states[0]);
    expect(JSON.parse(states[0]).memory).toEqual(byHash([ONE, TWO, THREE, FOUR]));
    expect(disk.has(sideKey())).toBe(false);
  });
});
