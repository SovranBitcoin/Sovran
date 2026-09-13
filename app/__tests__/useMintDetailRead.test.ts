import { act, renderHook, waitFor } from '@testing-library/react-native';
import { err, ok } from 'neverthrow';
import { useMintDetailRead } from '@/features/mint/hooks/useMintDetailRead';
import { mintReviewsCache, mintReviewsKey } from '@/features/mint/data/mintReviewsCache';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { getDiscoveredMintMetadata } from '@/shared/lib/getDiscoveredMintMetadata';
import { fetchMintReviews } from '@/shared/lib/nostr/fetchMintReviews';
import { retryMintInfoFetch } from '@/features/send/lib/createSovranScreenActionsBridge';
import { useMintProfiles } from '@/features/mint/hooks/useMintProfiles';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/shared/lib/getDiscoveredMintMetadata', () => ({
  getDiscoveredMintMetadata: jest.fn(),
}));
jest.mock('@/shared/lib/nostr/fetchMintReviews', () => ({ fetchMintReviews: jest.fn() }));
jest.mock('@/features/mint/hooks/useMintProfiles', () => ({ useMintProfiles: jest.fn() }));
jest.mock('@/features/send/lib/createSovranScreenActionsBridge', () => ({
  retryMintInfoFetch: jest.fn(() => true),
}));
jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return {
    log: { ...sink, child: () => sink },
    storeLog: sink,
    cashuLog: sink,
    monotonicNow: () => Date.now(),
    mintUrlLogFields: () => ({}),
  };
});

const MINT = 'https://mint.example.com';
const store = () => useMintMetadataStore.getState();

function stampAudit(state = 'OK') {
  store().mergeCached(MINT, { auditState: state, auditScore: 4, nMints: 10, nMelts: 5 }, ['audit']);
}

beforeEach(() => {
  jest.clearAllMocks();
  useMintMetadataStore.setState({ byMintUrl: {} });
  mintReviewsCache.clear();
  jest.mocked(getDiscoveredMintMetadata).mockImplementation(async () => store().getCached(MINT));
  jest
    .mocked(fetchMintReviews)
    .mockResolvedValue(
      ok({ mintUrl: MINT, score: 4.5, recommendations: [], lastUpdated: null, fromCache: false })
    );
});

it('serves fresh audit + review groups from the store with no round-trips', async () => {
  stampAudit();
  store().setReviewsAggregate(MINT, 4.2, 7);
  const { result } = renderHook(() => useMintDetailRead(MINT, { mintUrl: MINT, displayName: 'M' }));
  await waitFor(() => expect(result.current.reviews).toBe('ready'));
  expect(result.current.audit).toBe('ready');
  expect(result.current.identity).toBe('ready');
  expect(result.current.meta.auditScore).toBe(4);
  expect(getDiscoveredMintMetadata).not.toHaveBeenCalled();
  expect(fetchMintReviews).not.toHaveBeenCalled();
});

it('shows loading for a cold audit group, then ready once discovery stamps it', async () => {
  let finish!: () => void;
  jest.mocked(getDiscoveredMintMetadata).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => {
          stampAudit();
          resolve(store().getCached(MINT));
        };
      })
  );
  const { result } = renderHook(() => useMintDetailRead(MINT, { mintUrl: MINT }));
  expect(result.current.audit).toBe('loading');
  await act(async () => finish());
  await waitFor(() => expect(result.current.audit).toBe('ready'));
  expect(getDiscoveredMintMetadata).toHaveBeenCalledTimes(1);
});

it('reports error for an audit read that could not reach nagg, and retries on demand', async () => {
  const { result } = renderHook(() => useMintDetailRead(MINT, { mintUrl: MINT }));
  await waitFor(() => expect(result.current.audit).toBe('error'));
  jest.mocked(getDiscoveredMintMetadata).mockImplementation(async () => {
    stampAudit();
    return store().getCached(MINT);
  });
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.audit).toBe('ready'));
  expect(retryMintInfoFetch).not.toHaveBeenCalled();
});

it('writes the reviews aggregate through the shared cache so the reviews screen is a hit', async () => {
  stampAudit();
  const { result } = renderHook(() => useMintDetailRead(MINT, { mintUrl: MINT }));
  await waitFor(() => expect(result.current.reviews).toBe('ready'));
  expect(store().getCached(MINT)?.averageScore).toBe(4.5);
  expect(mintReviewsCache.getEntry(mintReviewsKey(MINT))?.data.score).toBe(4.5);
});

it('reports error for a failed reviews read only when no aggregate is known', async () => {
  stampAudit();
  jest.mocked(fetchMintReviews).mockResolvedValue(err(new Error('offline')));
  const cold = renderHook(() => useMintDetailRead(MINT, { mintUrl: MINT }));
  await waitFor(() => expect(cold.result.current.reviews).toBe('error'));
  cold.unmount();
  store().setReviewsAggregate(MINT, 3.9, 2);
  // Known but stale: paints the aggregate and revalidates behind it.
  store().mergeCached(MINT, { reviewsAt: 1 }, []);
  const warm = renderHook(() => useMintDetailRead(MINT, { mintUrl: MINT }));
  await waitFor(() => expect(fetchMintReviews).toHaveBeenCalledTimes(2));
  expect(warm.result.current.reviews).toBe('ready');
});

it('surfaces a failed identity read and routes retry to the bridge', () => {
  stampAudit();
  const { result } = renderHook(() =>
    useMintDetailRead(MINT, { mintUrl: MINT, _mintInfoError: 'The mint did not respond.' })
  );
  expect(result.current.identity).toBe('error');
  expect(result.current.identityError).toBe('The mint did not respond.');
  act(() => result.current.retry());
  expect(retryMintInfoFetch).toHaveBeenCalledTimes(1);
});

it('resolves the operator from discovery when the NUT-06 contact is a placeholder', async () => {
  stampAudit();
  store().setSocial(MINT, 12, 80, { operatorPubkey: 'ab'.repeat(32) });
  const { result } = renderHook(() =>
    useMintDetailRead(MINT, { mintUrl: MINT, contact: [{ method: 'nostr', info: 'npub\u2026' }] })
  );
  await waitFor(() => expect(result.current.social).toBe('ready'));
  expect(jest.mocked(useMintProfiles)).toHaveBeenLastCalledWith([
    { url: MINT, mintInfo: { contact: [{ method: 'nostr', info: 'ab'.repeat(32) }] } },
  ]);
});
