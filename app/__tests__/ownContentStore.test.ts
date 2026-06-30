/**
 * Unit tests for ownContentStore — the per-profile local cache of our own
 * authored notes. Covers the lifecycle (record/confirm/remove/ingest),
 * read scoping (profile isolation), and retention (FIFO cap + local age-out).
 */
/* eslint-disable import/first */

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (e: unknown) => e,
}));

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';
import {
  ingestOwnContent,
  LOCAL_GRACE_MS,
  MAX_CONFIRMED,
  useOwnContentStore,
} from '@/shared/stores/profile/ownContentStore';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function note(id: string, pubkey = ME): FeedEvent {
  return { id, kind: 1, pubkey, content: `hi ${id}`, tags: [], created_at: 1000 };
}

beforeEach(() => {
  useOwnContentStore.setState({ byId: {} });
  jest.restoreAllMocks();
});

describe('ownContentStore lifecycle', () => {
  it('records a note and reads it back, scoped to the active author', () => {
    const store = useOwnContentStore.getState();
    store.recordOwn(note('n1'), 'pending');

    expect(store.getOwn('n1')?.status).toBe('pending');
    expect(store.getOwn('n1', ME)?.event.content).toBe('hi n1');
    // Profile isolation: a different active author cannot read it.
    expect(store.getOwn('n1', OTHER)).toBeUndefined();
  });

  it('confirms a pending note to local; no-op once not pending', () => {
    const store = useOwnContentStore.getState();
    store.recordOwn(note('n1'), 'pending');
    store.confirmOwn('n1');
    expect(useOwnContentStore.getState().getOwn('n1')?.status).toBe('local');

    // confirmOwn only promotes pending → local.
    store.confirmOwn('n1');
    expect(useOwnContentStore.getState().getOwn('n1')?.status).toBe('local');
  });

  it('removes a note (failed publish leaves no phantom)', () => {
    const store = useOwnContentStore.getState();
    store.recordOwn(note('n1'), 'pending');
    store.removeOwn('n1');
    expect(useOwnContentStore.getState().getOwn('n1')).toBeUndefined();
  });

  it('ingestSeen settles a note as confirmed and is idempotent', () => {
    const store = useOwnContentStore.getState();
    store.recordOwn(note('n1'), 'pending');
    store.ingestSeen(note('n1'));
    expect(useOwnContentStore.getState().getOwn('n1')?.status).toBe('confirmed');

    const before = useOwnContentStore.getState().getOwn('n1')?.updatedAt;
    store.ingestSeen(note('n1')); // already confirmed → no-op
    expect(useOwnContentStore.getState().getOwn('n1')?.updatedAt).toBe(before);
  });
});

describe('ingestOwnContent passive seam', () => {
  it('records only our own kind:1 notes', () => {
    ingestOwnContent([note('mine'), note('theirs', OTHER), { ...note('repost'), kind: 6 }], ME);
    const store = useOwnContentStore.getState();
    expect(store.getOwn('mine')?.status).toBe('confirmed');
    expect(store.getOwn('theirs')).toBeUndefined(); // not ours
    expect(store.getOwn('repost')).toBeUndefined(); // not kind:1
  });

  it('no-ops without a viewer pubkey', () => {
    ingestOwnContent([note('mine')], undefined);
    expect(useOwnContentStore.getState().getOwn('mine')).toBeUndefined();
  });
});

describe('ownContentStore retention', () => {
  it('FIFO-caps confirmed entries, evicting the oldest', () => {
    const store = useOwnContentStore.getState();
    let t = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => (t += 1000));

    for (let i = 0; i < MAX_CONFIRMED + 5; i += 1) {
      store.ingestSeen(note(`c${i}`));
    }

    const byId = useOwnContentStore.getState().byId;
    expect(Object.keys(byId)).toHaveLength(MAX_CONFIRMED);
    // The five oldest were evicted.
    expect(byId['c0']).toBeUndefined();
    expect(byId['c4']).toBeUndefined();
    expect(byId[`c${MAX_CONFIRMED + 4}`]).toBeDefined();
  });

  it('ages out a local note relays never echo back, but keeps recent ones', () => {
    const store = useOwnContentStore.getState();
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    store.recordOwn(note('old'), 'pending');
    store.confirmOwn('old'); // → local at `now`

    now += LOCAL_GRACE_MS + 1; // advance past the grace window
    store.recordOwn(note('fresh'), 'pending'); // triggers prune

    const byId = useOwnContentStore.getState().byId;
    expect(byId['old']).toBeUndefined(); // aged out
    expect(byId['fresh']).toBeDefined();
  });
});
