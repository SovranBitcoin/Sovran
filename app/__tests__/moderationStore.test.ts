import { PersistedFeedIgnoreStore, useFeedIgnoreStore } from '../features/feed/stores/ignoreStore';
import type { MuteList } from '../features/feed/lib/moderation';

jest.mock('@sovranbitcoin/schemas', () => ({ loggableIssues: () => [] }), { virtual: true });
jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn() },
  log: { warn: jest.fn() },
  redactError: () => '',
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

const person = 'a'.repeat(64);
const other = 'b'.repeat(64);
const remote = (people: string[], createdAt = 10): MuteList => ({
  id: String(createdAt).padStart(64, '0'),
  createdAt,
  tags: [],
  privateTags: people.map((key) => ['p', key]),
});

describe('moderation persistence and optimistic reconciliation', () => {
  beforeEach(() => useFeedIgnoreStore.setState(useFeedIgnoreStore.getInitialState(), true));

  it('hydrates the old schema without losing ignored posts or people; filtering stays off', () => {
    expect(
      PersistedFeedIgnoreStore.parse({ ignoredPubkeys: [person], ignoredEventIds: [other] })
    ).toMatchObject({
      ignoredPubkeys: [person],
      ignoredEventIds: [other],
      dmFilterEnabled: false,
      dmFilterWords: [],
      muteList: null,
      blockOverrides: {},
    });
  });
  it('persists the exact projection after sync and dictionary changes', () => {
    const store = useFeedIgnoreStore.getState();
    store.ignorePubkey(person);
    store.setDmFilterWords('Word\nWORD');
    store.setDmFilterEnabled(true);
    store.receiveMuteList(remote([person]), { [person]: true });
    const state = useFeedIgnoreStore.getState();
    const projection = useFeedIgnoreStore.persist.getOptions().partialize!(state);
    expect(PersistedFeedIgnoreStore.parse(JSON.parse(JSON.stringify(projection)))).toEqual(
      projection
    );
    expect(state.blockOverrides).toEqual({});
  });
  it('retains a new block when an earlier unblock publish completes', () => {
    const store = useFeedIgnoreStore.getState();
    store.ignorePubkey(person);
    store.unignorePubkey(person);
    const publishedChoices = useFeedIgnoreStore.getState().blockOverrides;
    store.ignorePubkey(person);
    store.receiveMuteList(remote([]), publishedChoices);
    expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([person]);
    expect(useFeedIgnoreStore.getState().blockOverrides).toEqual({ [person]: true });
  });
  it('ignores an old relay echo and applies a newer remote unblock', () => {
    const store = useFeedIgnoreStore.getState();
    store.receiveMuteList(remote([person], 20));
    store.receiveMuteList(remote([other], 10));
    expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([person]);
    store.receiveMuteList(remote([], 30));
    expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([]);
  });
  it('rejects oversized imports and additions without silently unblocking anyone', () => {
    const people = Array.from({ length: 5000 }, (_, i) => i.toString(16).padStart(64, '0'));
    const store = useFeedIgnoreStore.getState();
    store.receiveMuteList(remote(people));
    const before = useFeedIgnoreStore.getState();
    expect(() => store.receiveMuteList(remote(people.concat(person), 20))).toThrow();
    expect(useFeedIgnoreStore.getState()).toBe(before);
    expect(() => store.ignorePubkey(person)).toThrow();
    expect(useFeedIgnoreStore.getState()).toBe(before);
  });
});
