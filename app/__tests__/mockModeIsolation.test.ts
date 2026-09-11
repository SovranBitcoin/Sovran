import { act, renderHook } from '@testing-library/react-native';

const mockMemory: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockMemory[key] ?? null,
    setItem: async (key: string, value: string) => {
      mockMemory[key] = value;
    },
    removeItem: async (key: string) => {
      delete mockMemory[key];
    },
  },
}));
jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: (e: { issues: unknown[] }) => e.issues,
}));
jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  applyFileLogging: jest.fn(),
  redactError: (e: unknown) => e,
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  withSkippedPersistWrites: (fn: () => void) => fn(),
}));
jest.mock('@/shared/lib/cashu/amount', () => ({ amountToNumber: Number, toCocoAmount: Number }));
const mockIngest = jest.fn();
jest.mock('@/shared/lib/nostr/useEntityCache', () => ({
  ingestResolvedProfiles: (...args: unknown[]) => mockIngest(...args),
}));

function mockStore(initial: Record<string, unknown>) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState: jest.fn((update: ((s: typeof state) => typeof state) | typeof state) => {
      state = { ...state, ...(typeof update === 'function' ? update(state) : update) };
    }),
    persist: {
      hasHydrated: () => true,
      onFinishHydration: (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    hydrate: () => {
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}
const mockScans = mockStore({ entries: [{ id: 'real-scan' }] });
const mockSwaps = mockStore({ groups: { real: { id: 'real' } } });
const mockLocations = mockStore({ locations: { real: { latitude: 1, longitude: 2 } } });
const mockProfiles = mockStore({ byPubkey: {} });
jest.mock('@/shared/stores/profile/scanHistoryStore', () => ({ useScanHistoryStore: mockScans }));
jest.mock('@/shared/stores/profile/swapTransactionsStore', () => ({
  useSwapTransactionsStore: mockSwaps,
}));
jest.mock('@/shared/stores/profile/transactionLocationStore', () => ({
  useTransactionLocationStore: mockLocations,
}));
jest.mock('@/shared/stores/global/nostrMetadataCache', () => ({
  useNostrMetadataCache: mockProfiles,
}));
const mockLiveHistory = [{ id: 'real-transaction', unit: 'sat' }];
jest.mock('wallet/react', () => ({
  useColadaTransactions: () => ({ history: mockLiveHistory, hasMore: false, isFetching: false }),
}));

const { useSettingsStore } =
  require('@/shared/stores/global/settingsStore') as typeof import('@/shared/stores/global/settingsStore');
const { useHistoryWithMelts } =
  require('@/features/transactions/hooks/useHistoryWithMelts') as typeof import('@/features/transactions/hooks/useHistoryWithMelts');

it('keeps demo data out of live stores through repeated toggles and late hydration', () => {
  const stores = [mockScans, mockSwaps, mockLocations, mockProfiles];
  const before = stores.map((store) => JSON.stringify(store.getState()));
  useSettingsStore.getState().setMockMode(true);
  useSettingsStore.getState().setMockMode(true);
  expect(stores.map((store) => JSON.stringify(store.getState()))).toEqual(before);
  useSettingsStore.getState().setMockMode(false);
  for (const store of stores) store.hydrate();
  expect(stores.map((store) => JSON.stringify(store.getState()))).toEqual(before);
  expect(stores.map((store) => store.listenerCount())).toEqual([0, 0, 0, 0]);
  expect(mockIngest).not.toHaveBeenCalled();
});

it('restores live history immediately when Mock Mode is disabled', () => {
  act(() => useSettingsStore.getState().setMockMode(false));
  const { result } = renderHook(() => useHistoryWithMelts());
  expect(result.current.history).toBe(mockLiveHistory);
  act(() => useSettingsStore.getState().setMockMode(true));
  expect(result.current.history.some((entry) => entry.id.startsWith('demo-'))).toBe(true);
  act(() => useSettingsStore.getState().setMockMode(false));
  expect(result.current.history).toBe(mockLiveHistory);
});

it('purges leaked fixture content without deleting a genuine profile sharing its public key', () => {
  const { purgeLegacyMockData } =
    require('@/shared/stores/runtime/mockDataStore') as typeof import('@/shared/stores/runtime/mockDataStore');
  const alice = '50d94fc2d8580c682b071a542f8b1e31a200b0508bab95a33bef0855df281d63';
  const bob = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';
  const genuine = { name: 'Jack', about: 'A real profile fetched from the relay', fetchedAt: 123 };
  mockProfiles.setState({
    byPubkey: {
      [alice]: {
        name: 'alice',
        about: 'mint operator. occasionally pays for coffee in sats.',
        fetchedAt: 0,
      },
      [bob]: genuine,
    },
  });
  purgeLegacyMockData();
  expect(mockProfiles.getState().byPubkey).toEqual({ [bob]: genuine });
  purgeLegacyMockData();
  expect(mockProfiles.getState().byPubkey).toEqual({ [bob]: genuine });
});

it('presents the demo Lightning receipt only after ecash issuance', () => {
  const { useMockDataStore } =
    require('@/shared/stores/runtime/mockDataStore') as typeof import('@/shared/stores/runtime/mockDataStore');
  const received = useMockDataStore.getState().mockHistory.find((entry) => entry.type === 'mint');
  expect(received).toMatchObject({ type: 'mint', state: 'ISSUED' });
});

it('keeps the wallet total and mint presentation balances coherent without inventing other units', () => {
  const { MOCK_MINT_BALANCES, getMockMintBalance, useMockDataStore } =
    require('@/shared/stores/runtime/mockDataStore') as typeof import('@/shared/stores/runtime/mockDataStore');
  expect(Object.values(MOCK_MINT_BALANCES).reduce((sum, balance) => sum + balance, 0)).toBe(
    useMockDataStore.getState().mockBalance
  );
  expect(getMockMintBalance('https://mint.macadamia.cash/', 'sat')).toBe(110_000);
  expect(getMockMintBalance('https://mint.macadamia.cash', 'usd')).toBe(0);
  expect(getMockMintBalance('https://unknown.invalid', 'sat')).toBe(0);
});

const mockPrivateConversations = [
  {
    counterparty: 'ab'.repeat(32),
    lastMessagePreview: 'Private live message',
    lastMessageIsOwn: false,
    lastMessageAt: 123,
  },
];
const mockDmReader = jest.fn((..._args: unknown[]) => ({
  conversations: mockPrivateConversations,
  loading: false,
  hasLoadedOnce: true,
  hasMore: true,
  loadMore: jest.fn(),
  refresh: jest.fn(),
  error: null,
}));
jest.mock('@/features/payments/hooks/useDmConversations', () => ({
  useDmConversations: (...args: unknown[]) => mockDmReader(...args),
}));
jest.mock('wallet', () => ({ getCounterparty: () => null }));
const mockRecentEntries = [{ pubkey: 'cd'.repeat(32), reason: 'search', lastOpenedAt: 100 }];
jest.mock('@/shared/stores/profile/recentPeopleStore', () => ({
  useRecentPeopleStore: (selector: (s: unknown) => unknown) =>
    selector({ entries: mockRecentEntries }),
  selectRecentPeople: (entries: unknown) => entries,
  normalizeRecentPersonPubkey: (key: unknown) => key,
}));
const mockProfileReader = jest.fn((..._args: unknown[]) => []);
jest.mock('@/features/feed/hooks/useRecentPeopleProfiles', () => ({
  useRecentPeopleProfiles: (...args: unknown[]) => mockProfileReader(...args),
}));

it('keeps fictional chats separate from public identities and restores private contacts after toggles', () => {
  const { useNip17RecentContacts } = require('@/features/payments/hooks/useNip17RecentContacts');
  const {
    getMockContacts,
    getMockProfileMetadata,
    getMockDmThread,
  } = require('@/shared/stores/runtime/mockDataStore');
  const { DEMO_RECENT_PUBKEYS } = require('@/shared/stores/runtime/mockPublicProfile');
  const keys = { pubkey: 'ab'.repeat(32) };
  act(() => useSettingsStore.getState().setMockMode(false));
  const { result } = renderHook(() => useNip17RecentContacts(keys));
  for (const enabled of [true, true, false, true, false]) {
    act(() => useSettingsStore.getState().setMockMode(enabled));
    expect(
      result.current.displayContacts.some((c: { pubkey: string }) => c.pubkey === keys.pubkey)
    ).toBe(!enabled);
    if (enabled) {
      expect(mockDmReader).toHaveBeenLastCalledWith(undefined, undefined);
      expect(result.current.conversations).toEqual([]);
      expect(result.current.hasMore).toBe(false);
      expect(result.current.displayContacts).toHaveLength(6);
      for (const contact of getMockContacts()) {
        expect(DEMO_RECENT_PUBKEYS).not.toContain(contact.pubkey);
        expect(getMockProfileMetadata(contact.pubkey).picture).toBeTruthy();
        expect(getMockProfileMetadata(contact.pubkey).lud16).toBeUndefined();
        expect(getMockDmThread(contact.pubkey).length).toBeGreaterThan(1);
      }
    }
  }
  expect(mockPrivateConversations[0].lastMessagePreview).toBe('Private live message');
});

it('uses reviewed public avatars in Send without persisting recents, then restores live people', () => {
  const { useQuickPayPeople } = require('@/features/send/hooks/useQuickPayPeople');
  const { DEMO_RECENT_PUBKEYS } = require('@/shared/stores/runtime/mockPublicProfile');
  const before = JSON.stringify(mockRecentEntries);
  act(() => useSettingsStore.getState().setMockMode(false));
  const { result } = renderHook(() => useQuickPayPeople([DEMO_RECENT_PUBKEYS[4]]));
  expect(result.current[0].pubkey).toBe(mockRecentEntries[0].pubkey);
  for (const enabled of [true, true, false, true, false]) {
    act(() => useSettingsStore.getState().setMockMode(enabled));
    if (enabled) {
      expect(mockProfileReader).toHaveBeenLastCalledWith([]);
      expect(result.current.map((p: { pubkey: string }) => p.pubkey)).toEqual(
        DEMO_RECENT_PUBKEYS.slice(0, 4)
      );
      for (const person of result.current) {
        expect(person.picture).toBeTruthy();
        expect(person.source).toBe('search');
      }
    } else expect(result.current[0].pubkey).toBe(mockRecentEntries[0].pubkey);
    expect(JSON.stringify(mockRecentEntries)).toBe(before);
  }
});
