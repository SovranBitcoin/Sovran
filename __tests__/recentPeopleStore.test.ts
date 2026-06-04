import {
  MAX_RECENT_PEOPLE,
  normalizeRecentPersonPubkey,
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
    const first = upsertRecentPerson([], pubkey('a'), 100);
    const second = upsertRecentPerson(first, pubkey('b'), 200);
    const third = upsertRecentPerson(second, pubkey('a'), 300);

    expect(third.map((entry) => entry.pubkey)).toEqual([pubkey('a'), pubkey('b')]);
    expect(third[0]).toMatchObject({
      pubkey: pubkey('a'),
      firstOpenedAt: 100,
      lastOpenedAt: 300,
    });
  });

  it('caps recent people at the configured maximum', () => {
    let entries: ReturnType<typeof upsertRecentPerson> = [];
    for (let index = 0; index < MAX_RECENT_PEOPLE + 5; index++) {
      entries = upsertRecentPerson(entries, index.toString(16).padStart(64, '0'), index);
    }

    expect(entries).toHaveLength(MAX_RECENT_PEOPLE);
    expect(entries[0].lastOpenedAt).toBe(MAX_RECENT_PEOPLE + 4);
    expect(entries.at(-1)?.lastOpenedAt).toBe(5);
  });
});

describe('useRecentPeopleStore', () => {
  beforeEach(() => {
    useRecentPeopleStore.setState({ entries: [] });
  });

  it('records a valid opened profile and ignores invalid inputs', () => {
    const { addRecentPerson } = useRecentPeopleStore.getState();
    addRecentPerson(pubkey('c'), 123);
    addRecentPerson('placeholder-2', 456);

    expect(useRecentPeopleStore.getState().entries).toEqual([
      { pubkey: pubkey('c'), firstOpenedAt: 123, lastOpenedAt: 123 },
    ]);
  });
});
