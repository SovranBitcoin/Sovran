/**
 * @jest-environment node
 *
 * Characterization of `useOwnEventsSync`, the one live subscription for the
 * person's own Nostr events. Batches of events are fed through a fake relay
 * subscription into the real partition and the real profile, social, own
 * content and own-profile stores. Only the NDK subscription, the keys
 * provider, the mute-list fetch, the follow worker, the Nostr cache layer and
 * storage are replaced.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useOwnEventsSync } from '@/shared/lib/nostr/ownsync/useOwnEventsSync';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { useOwnContentStore } from '@/shared/stores/profile/ownContentStore';
import { useOwnProfileMetadataStore } from '@/shared/stores/profile/ownProfileMetadataStore';

type RawEvent = {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
};

type Filter = { authors: string[]; kinds: number[]; since?: number; limit?: number };

let mockEvents: RawEvent[] = [];
let mockPubkey: string | undefined;
const mockSubscribeFilters: unknown[] = [];
/** When set, the fake relay returns only events some filter asks for, as a relay would. */
let mockRelayHonoursFilters = false;

function mockMatches(filters: Filter[] | null, event: RawEvent): boolean {
  return (filters ?? []).some(
    (filter) =>
      filter.authors.includes(event.pubkey) &&
      filter.kinds.includes(event.kind) &&
      event.created_at >= (filter.since ?? 0)
  );
}

jest.mock('@nostr-dev-kit/ndk-mobile', () => ({
  ...jest.requireActual('@nostr-dev-kit/ndk-mobile'),
  useSubscribe: ({ filters }: { filters: Filter[] | null }) => {
    mockSubscribeFilters.push(filters);
    return {
      events: mockRelayHonoursFilters
        ? mockEvents.filter((event) => mockMatches(filters, event))
        : mockEvents,
    };
  },
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: mockPubkey ? { pubkey: mockPubkey } : null }),
}));
jest.mock('@/shared/lib/nostr/ownsync/useMuteListSync', () => ({
  useMuteListSync: () => undefined,
}));
jest.mock('@/shared/lib/nostr/ownsync/useFollowSync', () => ({
  useFollowSync: () => undefined,
}));
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({ buildNostrDataLayer: () => null }));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));

const A = 'a1'.repeat(32);
const B = 'b2'.repeat(32);
const T = 1_760_000_000;

const id = (n: number | string) => String(n).padStart(64, '0');

function profileEvent(eventId: string, createdAt: number, name: string, pubkey = A): RawEvent {
  return {
    id: eventId,
    kind: 0,
    pubkey,
    content: JSON.stringify({ name }),
    tags: [],
    created_at: createdAt,
  };
}

function likeEvent(eventId: string, target: string, pubkey = A): RawEvent {
  return { id: eventId, kind: 7, pubkey, content: '+', tags: [['e', target]], created_at: T };
}

function activate(pubkey: string, accountIndex: number) {
  mockPubkey = pubkey;
  useProfileStore.setState({
    profiles: [
      { accountIndex: 0, pubkey: A, addedAt: 1 },
      { accountIndex: 1, pubkey: B, addedAt: 2 },
    ],
    activeAccountIndex: accountIndex,
  });
}

function deliver(rerender: () => void, events: RawEvent[]) {
  mockEvents = events;
  act(() => rerender());
}

function latestProfileId(): string | undefined {
  return useOwnProfileMetadataStore.getState().latest?.eventId;
}

function cachedName(accountIndex: number): string | undefined {
  return useProfileStore.getState().profiles.find((p) => p.accountIndex === accountIndex)
    ?.cachedDisplayName;
}

function liked(target: string): string | undefined {
  return useNostrSocialStore.getState().engagementByEventId[target]?.liked?.ownEventId;
}

function mount() {
  const view = renderHook(() => useOwnEventsSync());
  return { ...view, rerender: () => view.rerender({}) };
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  mockEvents = [];
  mockSubscribeFilters.length = 0;
  mockRelayHonoursFilters = false;
  activate(A, 0);
  useOwnProfileMetadataStore.setState({ latest: null });
  useNostrSocialStore.setState(useNostrSocialStore.getInitialState(), true);
  useOwnContentStore.setState({ byId: {} });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useOwnEventsSync', () => {
  it('asks for the newest profile and follow list with no window, and a year of the rest, live', () => {
    jest.spyOn(Date, 'now').mockReturnValue(T * 1000);
    const { unmount } = mount();

    expect(mockSubscribeFilters.at(-1)).toEqual([
      { authors: [A], kinds: [0], limit: 1 },
      { authors: [A], kinds: [3], limit: 1 },
      {
        authors: [A],
        kinds: [1, 5, 6, 7],
        since: T - 365 * 24 * 60 * 60,
        limit: 5000,
      },
    ]);
    unmount();
  });

  it('receives a follow list last changed more than a year ago', () => {
    jest.spyOn(Date, 'now').mockReturnValue(T * 1000);
    mockRelayHonoursFilters = true;
    const { rerender, unmount } = mount();
    const old = T - 2 * 365 * 24 * 60 * 60;

    deliver(rerender, [
      { id: id(50), kind: 3, pubkey: A, content: '', tags: [['p', B]], created_at: old },
      profileEvent(id(51), old, 'Old profile'),
    ]);

    expect(useNostrSocialStore.getState().contactsTags).toEqual([['p', B]]);
    expect(useNostrSocialStore.getState().contactsUpdatedAt).toBe(old);
    expect(latestProfileId()).toBe(id(51));
    unmount();
  });

  it('refuses a follow list written by another account', () => {
    const { rerender, unmount } = mount();

    deliver(rerender, [
      { id: id(52), kind: 3, pubkey: B, content: '', tags: [['p', A]], created_at: T },
    ]);

    expect(useNostrSocialStore.getState().contactsTags).toEqual([]);
    expect(useNostrSocialStore.getState().followingPubkeys).toEqual({});
    unmount();
  });

  it('keeps its own follow list when another account wrote a newer one in the same batch', () => {
    const { rerender, unmount } = mount();

    deliver(rerender, [
      { id: id(53), kind: 3, pubkey: A, content: '', tags: [['p', B]], created_at: T },
      { id: id(54), kind: 3, pubkey: B, content: '', tags: [['p', A]], created_at: T + 5 },
    ]);

    expect(useNostrSocialStore.getState().contactsTags).toEqual([['p', B]]);
    unmount();
  });

  it('asks for nothing without keys', () => {
    mockPubkey = undefined;
    const { unmount } = mount();

    expect(mockSubscribeFilters.at(-1)).toBeNull();
    unmount();
  });

  it('applies the active account profile and its cached name', () => {
    const { rerender, unmount } = mount();

    deliver(rerender, [profileEvent(id(1), T, 'Alice')]);

    expect(latestProfileId()).toBe(id(1));
    expect(cachedName(0)).toBe('Alice');
    unmount();
  });

  it('keeps the newest profile when an older one arrives in a later batch', () => {
    const { rerender, unmount } = mount();

    deliver(rerender, [profileEvent(id(1), T, 'New')]);
    deliver(rerender, [profileEvent(id(1), T, 'New'), profileEvent(id(2), T - 10, 'Old')]);

    expect(latestProfileId()).toBe(id(1));
    expect(cachedName(0)).toBe('New');
    unmount();
  });

  it('picks the lower id between equal-time profiles in one batch', () => {
    const { rerender, unmount } = mount();

    deliver(rerender, [profileEvent(id('b'), T, 'B-id'), profileEvent(id('a'), T, 'A-id')]);

    expect(latestProfileId()).toBe(id('a'));
    unmount();
  });

  it('picks the lower id between equal-time profiles across batches too', () => {
    const { rerender, unmount } = mount();

    deliver(rerender, [profileEvent(id('b'), T, 'B-id')]);
    deliver(rerender, [profileEvent(id('b'), T, 'B-id'), profileEvent(id('a'), T, 'A-id')]);

    // The same profile wins however the events are split into batches.
    expect(latestProfileId()).toBe(id('a'));
    expect(cachedName(0)).toBe('A-id');
    unmount();
  });

  it('never applies a profile without a time, even as the first one the session sees', () => {
    const { rerender, unmount } = mount();

    deliver(rerender, [profileEvent(id(70), 0, 'No time')]);

    expect(latestProfileId()).toBeUndefined();
    expect(cachedName(0)).toBeUndefined();
    unmount();
  });

  it('keeps the saved profile when a new session sees an equal-time one with a higher id', () => {
    useOwnProfileMetadataStore.setState({
      latest: { content: { name: 'Saved' }, createdAt: T, eventId: id('a') },
    });
    const { rerender, unmount } = mount();

    deliver(rerender, [profileEvent(id('b'), T, 'B-id')]);

    expect(latestProfileId()).toBe(id('a'));
    expect(cachedName(0)).toBeUndefined();
    unmount();
  });

  it('dispatches an event id only once, even when relays deliver it again', () => {
    const { rerender, unmount } = mount();
    const like = likeEvent(id(10), 'target-1');

    deliver(rerender, [like]);
    expect(liked('target-1')).toBe(id(10));

    useNostrSocialStore.setState({ engagementByEventId: {} });
    deliver(rerender, [like]);

    expect(liked('target-1')).toBeUndefined();
    unmount();
  });

  it('records own notes and applies own deletions', () => {
    const { rerender, unmount } = mount();
    const note: RawEvent = {
      id: id(20),
      kind: 1,
      pubkey: A,
      content: 'hello',
      tags: [],
      created_at: T,
    };

    deliver(rerender, [note, likeEvent(id(21), 'target-2')]);
    expect(useOwnContentStore.getState().byId[id(20)]).toBeDefined();
    expect(liked('target-2')).toBe(id(21));

    deliver(rerender, [
      note,
      { id: id(22), kind: 5, pubkey: A, content: '', tags: [['e', id(21)]], created_at: T + 1 },
    ]);
    expect(liked('target-2')).toBeUndefined();
    unmount();
  });

  it('does not apply another account profile while this one is active', () => {
    const { rerender, unmount } = mount();

    deliver(rerender, [profileEvent(id(30), T, 'Bob', B)]);

    expect(latestProfileId()).toBeUndefined();
    expect(cachedName(1)).toBeUndefined();
    unmount();
  });

  it('writes nothing while the keys and the active account disagree, and catches up after', () => {
    const { rerender, unmount } = mount();
    // The active account has moved to B; the keys provider still holds A's keys.
    useProfileStore.setState({ activeAccountIndex: 1 });

    deliver(rerender, [
      likeEvent(id(60), 'target-4'),
      profileEvent(id(61), T, 'Alice'),
      { id: id(62), kind: 3, pubkey: A, content: '', tags: [['p', B]], created_at: T },
    ]);

    // The loaded stores are B's: none of A's events go into them.
    expect(liked('target-4')).toBeUndefined();
    expect(latestProfileId()).toBeUndefined();
    expect(useNostrSocialStore.getState().contactsTags).toEqual([]);

    // The switch is rolled back to A: the same batch is written now, once.
    useProfileStore.setState({ activeAccountIndex: 0 });
    act(() => rerender());
    expect(liked('target-4')).toBe(id(60));
    expect(latestProfileId()).toBe(id(61));
    expect(useNostrSocialStore.getState().contactsTags).toEqual([['p', B]]);
    unmount();
  });

  it('applies events left unseen mid-switch when the account later subscribes again', () => {
    jest.spyOn(Date, 'now').mockReturnValue(T * 1000);
    mockRelayHonoursFilters = true;
    const { rerender, unmount } = mount();
    const aFilters = mockSubscribeFilters.at(-1);
    // The active account has moved to B; the keys still hold A's.
    useProfileStore.setState({ activeAccountIndex: 1 });
    deliver(rerender, [likeEvent(id(80), 'target-6'), profileEvent(id(81), T, 'Alice')]);
    expect(liked('target-6')).toBeUndefined();

    // The keys follow to B: A's subscription is replaced before A's events were written.
    activate(B, 1);
    act(() => rerender());
    expect(liked('target-6')).toBeUndefined();

    // Back to A: its new subscription asks the same filters, so the relay
    // delivers the same events again and they are written then.
    activate(A, 0);
    act(() => rerender());
    expect(mockSubscribeFilters.at(-1)).toEqual(aFilters);
    expect(liked('target-6')).toBe(id(80));
    expect(latestProfileId()).toBe(id(81));
    unmount();
  });

  it('starts over for a new account, and leaves the previous account events out of it', () => {
    const { rerender, unmount } = mount();
    const like = likeEvent(id(40), 'target-3');
    deliver(rerender, [like]);

    useNostrSocialStore.setState({ engagementByEventId: {} });
    activate(B, 1);
    // The subscription still holds A's like when B's first own event arrives.
    deliver(rerender, [like, likeEvent(id(41), 'target-5', B)]);

    expect(liked('target-3')).toBeUndefined();
    expect(liked('target-5')).toBe(id(41));
    unmount();
  });
});
