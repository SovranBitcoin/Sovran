import {
  MAX_RECENT_PEOPLE,
  normalizeRecentPersonPubkey,
  selectRecentPeople,
  upsertRecentPerson,
  useRecentPeopleStore,
} from '@/shared/stores/profile/recentPeopleStore';

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: () => [],
}));

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

const pubkey = (char: string) => char.repeat(64);

describe('recent people store helpers', () => {
  it('normalizes valid hex pubkeys and rejects non-profile placeholders', () => {
    expect(normalizeRecentPersonPubkey(` ${pubkey('A')} `)).toBe(pubkey('a'));
    expect(normalizeRecentPersonPubkey('placeholder-1')).toBeNull();
    expect(normalizeRecentPersonPubkey('npub1abc')).toBeNull();
  });

  it('moves an existing person to the front while preserving firstOpenedAt', () => {
    const first = upsertRecentPerson([], pubkey('a'), 'search', 100);
    const second = upsertRecentPerson(first, pubkey('b'), 'search', 200);
    const third = upsertRecentPerson(second, pubkey('a'), 'search', 300);

    expect(third.map((entry) => entry.pubkey)).toEqual([pubkey('a'), pubkey('b')]);
    expect(third[0]).toMatchObject({
      pubkey: pubkey('a'),
      firstOpenedAt: 100,
      lastOpenedAt: 300,
      reason: 'search',
    });
  });

  it('defaults the reason to search', () => {
    const [entry] = upsertRecentPerson([], pubkey('a'));
    expect(entry.reason).toBe('search');
  });

  it('never downgrades a peer to search, but upgrades search to peer', () => {
    // A later profile view ('search') must not erase that we stood near them.
    const peer = upsertRecentPerson([], pubkey('a'), 'peer', 100);
    const viewedAgain = upsertRecentPerson(peer, pubkey('a'), 'search', 200);
    expect(viewedAgain[0]).toMatchObject({ reason: 'peer', lastOpenedAt: 200 });

    const viewed = upsertRecentPerson([], pubkey('b'), 'search', 100);
    const seenNearby = upsertRecentPerson(viewed, pubkey('b'), 'peer', 200);
    expect(seenNearby[0].reason).toBe('peer');
  });

  it('keeps the freshest known name and never clobbers it with a blank', () => {
    const named = upsertRecentPerson([], pubkey('a'), 'peer', 100, 'Calle');
    expect(named[0].displayName).toBe('Calle');
    const reSeen = upsertRecentPerson(named, pubkey('a'), 'peer', 200, '   ');
    expect(reSeen[0]).toMatchObject({ displayName: 'Calle', lastOpenedAt: 200 });
  });

  it('omits displayName when none is supplied', () => {
    const [entry] = upsertRecentPerson([], pubkey('a'), 'peer', 100);
    expect(entry).not.toHaveProperty('displayName');
  });

  it('caps recent people at the configured maximum', () => {
    let entries: ReturnType<typeof upsertRecentPerson> = [];
    for (let index = 0; index < MAX_RECENT_PEOPLE + 5; index++) {
      entries = upsertRecentPerson(entries, index.toString(16).padStart(64, '0'), 'search', index);
    }

    expect(entries).toHaveLength(MAX_RECENT_PEOPLE);
    expect(entries[0].lastOpenedAt).toBe(MAX_RECENT_PEOPLE + 4);
    expect(entries.at(-1)?.lastOpenedAt).toBe(5);
  });

  it('selects all remembered people (searched + peers) by recency', () => {
    let entries: ReturnType<typeof upsertRecentPerson> = [];
    entries = upsertRecentPerson(entries, pubkey('a'), 'search', 100);
    entries = upsertRecentPerson(entries, pubkey('b'), 'peer', 200);
    entries = upsertRecentPerson(entries, pubkey('c'), 'search', 300);

    const people = selectRecentPeople(entries);
    expect(people.map((entry) => entry.pubkey)).toEqual([pubkey('c'), pubkey('b'), pubkey('a')]);
  });
});

describe('useRecentPeopleStore', () => {
  beforeEach(() => {
    useRecentPeopleStore.setState({ entries: [] });
  });

  it('records a valid opened profile and ignores invalid inputs', () => {
    const { addRecentPerson } = useRecentPeopleStore.getState();
    addRecentPerson(pubkey('c'), { at: 123 });
    addRecentPerson('placeholder-2', { at: 456 });

    expect(useRecentPeopleStore.getState().entries).toEqual([
      { pubkey: pubkey('c'), firstOpenedAt: 123, lastOpenedAt: 123, reason: 'search' },
    ]);
  });

  it('records peer provenance when supplied', () => {
    const { addRecentPerson } = useRecentPeopleStore.getState();
    addRecentPerson(pubkey('e'), { reason: 'peer', at: 10 });
    expect(useRecentPeopleStore.getState().entries[0]).toMatchObject({
      pubkey: pubkey('e'),
      reason: 'peer',
    });
  });
});
