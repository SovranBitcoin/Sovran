/**
 * The Search tab's read: Tier-0 rows on the first render of a one-character
 * query, Bluetooth with no location, and nothing secret or payable ever handed
 * to the remote people search.
 */
import { renderHook } from '@testing-library/react-native';

import { INPUTS } from '../../../../wallet/__tests__/_harness/fixtures';
import { useSearchAggregates } from '@/shared/ui/composed/search/useSearchAggregates';

const mockRemoteQueries: string[] = [];
const mockRetry = jest.fn();
let mockRemoteStatus = 'idle';

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));
jest.mock('@/shared/config/features', () => ({
  ...jest.requireActual('@/shared/config/features'),
  hasFeature: () => true,
}));
jest.mock('@/runtime/WalletProjection', () => {
  const { WALLETS: wallets } = jest.requireActual('../../../../wallet/__tests__/_harness/fixtures');
  return { useWalletContext: () => wallets.default };
});
jest.mock('@/features/search/hooks/useOverlaidContactSearch', () => ({
  useOverlaidContactSearch: (query: string) => {
    mockRemoteQueries.push(query);
    return { contactRows: [], loading: false, status: mockRemoteStatus, retry: mockRetry };
  },
}));
jest.mock('@/features/search/hooks/useLocalSearchCandidates', () => ({
  useLocalSearchCandidates: () => ({
    people: [
      { pubkey: 'a'.repeat(64), source: 'recent', displayName: 'Alice' },
      { pubkey: 'b'.repeat(64), source: 'following', displayName: 'Bob' },
    ],
    mints: [{ mintUrl: 'https://mint.alpha.example', displayName: 'Alpha' }],
  }),
}));
jest.mock('@/features/mint/hooks/useMintSearch', () => ({
  useMintSearch: () => ({ results: [] }),
}));
jest.mock('@/features/bitchat/hooks/useLocationTiers', () => ({
  ...jest.requireActual('@/features/bitchat/hooks/useLocationTiers'),
  // Location denied or unavailable: no tiers at all.
  useLocationTiers: () => ({ tiers: [], loading: false, error: 'denied' }),
}));

beforeEach(() => {
  mockRemoteQueries.length = 0;
  mockRemoteStatus = 'idle';
});

const lastRemoteQuery = () => mockRemoteQueries[mockRemoteQueries.length - 1];

it('shows local people and mints on the first render of a one-character query', () => {
  const { result } = renderHook(() => useSearchAggregates('a'));
  expect(result.current.items.map((item) => item.id)).toEqual([
    'header:people',
    `person:${'a'.repeat(64)}`,
    'header:mints',
    'mint:mint.alpha.example',
  ]);
});

it('surfaces Bluetooth with no location', () => {
  for (const query of ['bluetooth', 'mesh', 'nearby', 'bitchat']) {
    const { result } = renderHook(() => useSearchAggregates(query));
    expect(result.current.items.map((item) => item.id)).toContain('tier:bluetooth');
  }
});

it('hands words to the remote people search', () => {
  renderHook(() => useSearchAggregates('  alice '));
  expect(lastRemoteQuery()).toBe('alice');
});

it.each([
  ['an ecash token', INPUTS.cashuTokenV3],
  ['an invoice', INPUTS.bolt11WithAmount],
  ['a private key', 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5'],
  ['a pairing link', 'bunker://ab12?relay=wss://relay.example&secret=s3cret'],
])('keeps %s off the remote search and out of recents', (_name, input) => {
  mockRemoteStatus = 'ready';
  const { result } = renderHook(() => useSearchAggregates(input));
  expect(mockRemoteQueries.length).toBeGreaterThan(0);
  expect(mockRemoteQueries.every((query) => query === '')).toBe(true);
  expect(result.current.recordable).toBe(false);
});

it('puts the action card first for a payment string', () => {
  const { result } = renderHook(() => useSearchAggregates(INPUTS.cashuTokenV3));
  expect(result.current.kind.kind).toBe('payment');
  expect(result.current.items[0]?.type).toBe('action');
});

it('shows nothing at all for a secret', () => {
  const { result } = renderHook(() =>
    useSearchAggregates('nostrconnect://abc?relay=wss%3A%2F%2Fr&secret=s3cret')
  );
  expect(result.current.kind).toEqual({ kind: 'sensitive' });
  expect(result.current.items).toEqual([]);
});

it('records a settled word search that found something, and not while it loads', () => {
  mockRemoteStatus = 'loading';
  expect(renderHook(() => useSearchAggregates('alice')).result.current.recordable).toBe(false);
  mockRemoteStatus = 'ready';
  expect(renderHook(() => useSearchAggregates('alice')).result.current.recordable).toBe(true);
  // Matches nothing ('i' is not a geohash letter either).
  expect(renderHook(() => useSearchAggregates('iiii')).result.current.recordable).toBe(false);
});
