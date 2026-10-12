/**
 * @jest-environment node
 *
 * What the person muted and blocked is read back entry by entry. One entry
 * that is not an id must cost that entry, never the whole saved store.
 */
import { PersistedFeedIgnoreStore } from '@/features/feed/stores/ignoreStore';

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  };
  return { __esModule: true, default: storage, ...storage };
});

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const NOTE = 'c'.repeat(64);
const MUTE_LIST = { id: NOTE, createdAt: 1_700_000_000, tags: [['p', A]], privateTags: [] };

it('reads back a saved list as it was written', () => {
  const saved = {
    ignoredPubkeys: [A, B],
    ignoredEventIds: [NOTE],
    muteList: MUTE_LIST,
    blockOverrides: { [A]: true, [B]: false },
    dmFilterEnabled: true,
    dmFilterWords: ['spam'],
  };
  expect(PersistedFeedIgnoreStore.parse(saved)).toEqual(saved);
});

it('leaves out an entry that is not an id and keeps the rest', () => {
  const parsed = PersistedFeedIgnoreStore.parse({
    ignoredPubkeys: [A, 'npub1notHex', 42, B],
    ignoredEventIds: ['short', NOTE, null],
    muteList: MUTE_LIST,
    blockOverrides: { [A]: true, 'not-a-key': true, [B]: 'yes' },
    dmFilterEnabled: true,
    dmFilterWords: ['spam'],
  });
  expect(parsed.ignoredPubkeys).toEqual([A, B]);
  expect(parsed.ignoredEventIds).toEqual([NOTE]);
  expect(parsed.blockOverrides).toEqual({ [A]: true });
  expect(parsed.muteList).toEqual(MUTE_LIST);
  expect(parsed.dmFilterWords).toEqual(['spam']);
});

it('keeps the lists when the copy of the published mute list cannot be read', () => {
  const parsed = PersistedFeedIgnoreStore.parse({
    ignoredPubkeys: [A],
    ignoredEventIds: [NOTE],
    muteList: { id: 'not-an-id', createdAt: 1, tags: [], privateTags: [] },
    blockOverrides: { [A]: true },
  });
  // The published list is fetched again; what was blocked on this phone stays.
  expect(parsed.muteList).toBeNull();
  expect(parsed.ignoredPubkeys).toEqual([A]);
  expect(parsed.blockOverrides).toEqual({ [A]: true });
});

it('still reads an id an earlier build could have saved in upper case', () => {
  expect(
    PersistedFeedIgnoreStore.parse({ ignoredPubkeys: [A.toUpperCase()] }).ignoredPubkeys
  ).toEqual([A.toUpperCase()]);
});
