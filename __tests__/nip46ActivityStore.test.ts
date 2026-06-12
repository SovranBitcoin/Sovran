/**
 * Pins the NIP-46 activity log: 500-entry tail-evict cap, 30-day prune in
 * afterHydrate, summary truncation to 120 chars, persisted round-trip, and
 * merge rejection of malformed blobs. The entry shape structurally cannot
 * hold params/plaintexts/ciphertexts — only the engine-curated summary.
 */

/* eslint-disable import/first */

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: () => [],
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => {
  const map = new Map<string, string>();
  return {
    createProfileScopedStorage: () => ({
      getItem: (key: string) => Promise.resolve(map.get(key) ?? null),
      setItem: (key: string, value: string) => {
        map.set(key, value);
        return Promise.resolve();
      },
      removeItem: (key: string) => {
        map.delete(key);
        return Promise.resolve();
      },
    }),
    __storageMap: map,
  };
});

import {
  useNip46ActivityStore,
  type Nip46ActivityEntry,
} from '@/features/nostrSigner/data/nip46ActivityStore';
import { ACTIVITY_CAP } from '@/features/nostrSigner/lib/nip46Types';

const { __storageMap: storageMap } = jest.requireMock(
  '@/shared/lib/cashu/profileScopedStorage'
) as {
  __storageMap: Map<string, string>;
};

const STORAGE_KEY = 'nip46-activity-store';
const CLIENT = 'a'.repeat(64);
const DAY_MS = 24 * 60 * 60 * 1000;

function entry(overrides: Partial<Nip46ActivityEntry> = {}): Nip46ActivityEntry {
  return {
    id: `nip46-${Math.random()}`,
    clientPubkey: CLIENT,
    method: 'sign_event',
    kind: 1,
    verdict: 'approved_once',
    at: Date.now(),
    ...overrides,
  };
}

function writeBlob(entries: Nip46ActivityEntry[]): void {
  storageMap.set(STORAGE_KEY, JSON.stringify({ state: { entries }, version: 1 }));
}

async function flushPersistWrites(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  storageMap.clear();
  useNip46ActivityStore.setState({ entries: [] });
});

describe('logActivity', () => {
  it('prepends newest first with a minted id', () => {
    const log = useNip46ActivityStore.getState().logActivity;
    log({ clientPubkey: CLIENT, method: 'ping', verdict: 'auto_approved_method', at: 1 });
    log({ clientPubkey: CLIENT, method: 'sign_event', kind: 1, verdict: 'approved_once', at: 2 });

    const entries = useNip46ActivityStore.getState().entries;
    expect(entries).toHaveLength(2);
    expect(entries[0].at).toBe(2);
    expect(entries[0].id).toMatch(/^nip46-/);
    expect(entries[0].id).not.toBe(entries[1].id);
  });

  it('tail-evicts beyond the 500 cap', () => {
    const log = useNip46ActivityStore.getState().logActivity;
    for (let i = 0; i < ACTIVITY_CAP + 1; i++) {
      log({ clientPubkey: CLIENT, method: 'ping', verdict: 'auto_approved_method', at: i });
    }
    const entries = useNip46ActivityStore.getState().entries;
    expect(entries).toHaveLength(ACTIVITY_CAP);
    expect(entries[0].at).toBe(ACTIVITY_CAP);
    // The very first (oldest) entry fell off the tail.
    expect(entries[entries.length - 1].at).toBe(1);
  });

  it('truncates content previews and summary lines at the persistence bound', () => {
    useNip46ActivityStore.getState().logActivity({
      clientPubkey: CLIENT,
      method: 'sign_event',
      kind: 1,
      verdict: 'auto_approved_grant',
      summary: { headline: 'h'.repeat(100), line: 'l'.repeat(300) },
      contentPreview: 'x'.repeat(300),
    });
    const entry0 = useNip46ActivityStore.getState().entries[0];
    expect(entry0.contentPreview).toHaveLength(120);
    expect(entry0.summary?.line).toHaveLength(120);
    expect(entry0.summary?.headline).toHaveLength(64);
  });
});

describe('persistence', () => {
  it('round-trips through the schema-validated merge', async () => {
    useNip46ActivityStore.getState().logActivity({
      clientPubkey: CLIENT,
      method: 'sign_event',
      kind: 1,
      verdict: 'approved_once',
      summary: { headline: 'Publish a Post', line: 'Published a post' },
      contentPreview: 'hello nostr',
      eventId: 'b'.repeat(64),
    });
    await flushPersistWrites();

    const blob = storageMap.get(STORAGE_KEY);
    expect(blob).toBeDefined();
    const before = useNip46ActivityStore.getState().entries;
    // Resetting state triggers a persist write of the empty state — flush it,
    // then restore the captured blob so rehydrate reads the real data.
    useNip46ActivityStore.setState({ entries: [] });
    await flushPersistWrites();
    storageMap.set(STORAGE_KEY, blob!);
    await useNip46ActivityStore.persist.rehydrate();

    expect(useNip46ActivityStore.getState().entries).toEqual(before);
  });

  it('rejects a malformed blob at merge and keeps defaults', async () => {
    writeBlob([entry({ verdict: 'approved_forever' as Nip46ActivityEntry['verdict'] })]);
    await useNip46ActivityStore.persist.rehydrate();
    expect(useNip46ActivityStore.getState().entries).toEqual([]);
  });

  it('rejects a blob smuggling an over-long content preview', async () => {
    writeBlob([entry({ contentPreview: 'x'.repeat(200) })]);
    await useNip46ActivityStore.persist.rehydrate();
    expect(useNip46ActivityStore.getState().entries).toEqual([]);
  });

  it('prunes entries older than 30 days after hydration', async () => {
    const now = Date.now();
    const fresh = entry({ id: 'nip46-fresh', at: now - DAY_MS });
    const stale = entry({ id: 'nip46-stale', at: now - 31 * DAY_MS });
    writeBlob([fresh, stale]);

    await useNip46ActivityStore.persist.rehydrate();

    const entries = useNip46ActivityStore.getState().entries;
    expect(entries.map((e) => e.id)).toEqual(['nip46-fresh']);
  });
});
