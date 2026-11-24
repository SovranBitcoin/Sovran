import { act, renderHook, waitFor } from '@testing-library/react-native';
import { err, ok } from 'neverthrow';
import { useMintDetailRead } from '@/features/mint/hooks/useMintDetailRead';
import { mintReviewsCache, mintReviewsKey } from '@/features/mint/data/mintReviewsCache';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { getDiscoveredMintMetadata } from '@/shared/lib/getDiscoveredMintMetadata';
import { fetchMintReviews } from '@/shared/lib/nostr/fetchMintReviews';
import { retryMintInfoFetch } from '@/features/send/lib/createSovranScreenActionsBridge';
import { useMintProfiles } from '@/features/mint/hooks/useMintProfiles';
import { readMintAuditDetail } from '@/features/mint/lib/mintAuditDetail';
import { fenceDataReset } from '@/shared/lib/account/dataResetFence';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
// Focus is mount here: the first focus runs the effect once, and a test
// refocuses by calling what it was given.
let mockRefocus: () => void = () => {};
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    mockRefocus = effect;
    useEffect(() => {
      effect();
    }, [effect]);
  },
}));
jest.mock('@/shared/lib/getDiscoveredMintMetadata', () => ({
  getDiscoveredMintMetadata: jest.fn(),
}));
jest.mock('@/shared/lib/nostr/fetchMintReviews', () => ({ fetchMintReviews: jest.fn() }));
jest.mock('@/features/mint/hooks/useMintProfiles', () => ({ useMintProfiles: jest.fn() }));
// Mint Info's own per-mint auditor reads: stubbed, so no test reaches a network.
jest.mock('@/features/mint/lib/mintAuditDetail', () => ({
  mintAuditDetailDue: () => true,
  readMintAuditDetail: jest.fn(),
}));
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
    applyFileLogging: jest.fn(),
    redactError: (e: unknown) => e,
  };
});

const MINT = 'https://mint.example.com';
const store = () => useMintMetadataStore.getState();

function stampAudit(state = 'OK') {
  store().mergeCached(MINT, { auditState: state, nMints: 10, nMelts: 6, nErrors: 4 }, ['audit']);
}

beforeEach(() => {
  jest.clearAllMocks();
  useMintMetadataStore.setState({ byMintUrl: {} });
  mintReviewsCache.clear();
  jest.mocked(getDiscoveredMintMetadata).mockImplementation(async () => store().getCached(MINT));
  jest.mocked(readMintAuditDetail).mockResolvedValue({ updates: [], answered: false });
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
  expect(result.current.meta.audit).toMatchObject({ state: 'OK', score: 4, totalOps: 20 });
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
  // Asked once the saved settings and mint rows have loaded.
  await waitFor(() => expect(getDiscoveredMintMetadata).toHaveBeenCalledTimes(1));
  expect(result.current.audit).toBe('loading');
  await act(async () => finish());
  await waitFor(() => expect(result.current.audit).toBe('ready'));
  expect(getDiscoveredMintMetadata).toHaveBeenCalledTimes(1);
});

it('does not ask nagg for the audit when Delete All ran while the saved stores loaded', async () => {
  let loadSettings!: () => void;
  const rehydrated = new Promise<void>((resolve) => {
    loadSettings = resolve;
  });
  // Settings are still loading when the page opens.
  const hydrated = jest.spyOn(useSettingsStore.persist, 'hasHydrated').mockReturnValue(false);
  const listeners: (() => void)[] = [];
  const onFinish = jest
    .spyOn(useSettingsStore.persist, 'onFinishHydration')
    .mockImplementation((listener) => {
      listeners.push(listener as () => void);
      return () => {};
    });
  const { result } = renderHook(() => useMintDetailRead(MINT, { mintUrl: MINT }));
  fenceDataReset();
  hydrated.mockReturnValue(true);
  await act(async () => {
    loadSettings();
    await rehydrated;
    for (const listener of listeners) listener();
  });
  await waitFor(() => expect(result.current.audit).toBe('error'));
  expect(getDiscoveredMintMetadata).not.toHaveBeenCalled();
  hydrated.mockRestore();
  onFinish.mockRestore();
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

it('reads a failed group again when the page is returned to, and not before', async () => {
  stampAudit();
  jest.mocked(fetchMintReviews).mockResolvedValue(err(new Error('offline')));
  const { result } = renderHook(() => useMintDetailRead(MINT, { mintUrl: MINT }));
  await waitFor(() => expect(result.current.reviews).toBe('error'));
  // The failure alone is not a reason to try again.
  expect(fetchMintReviews).toHaveBeenCalledTimes(1);
  act(() => mockRefocus());
  await waitFor(() => expect(fetchMintReviews).toHaveBeenCalledTimes(2));
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

it('accepts late review updates until the detail read is aborted', async () => {
  stampAudit();
  let update: Parameters<typeof fetchMintReviews>[0]['onUpdate'];
  const first = {
    mintUrl: MINT,
    score: null,
    reviewCount: 1,
    recommendations: [],
    lastUpdated: null,
    fromCache: false,
  };
  jest.mocked(fetchMintReviews).mockImplementation(async (args) => {
    update = args.onUpdate;
    return ok(first);
  });
  const hook = renderHook(() => useMintDetailRead(MINT, { mintUrl: MINT }));
  await waitFor(() => expect(hook.result.current.reviews).toBe('ready'));
  act(() => update?.({ ...first, tier: 'nagg', score: 4.5, reviewCount: 90 }));
  expect(store().getCached(MINT)).toMatchObject({ averageScore: 4.5, reviewCount: 90 });
  expect(mintReviewsCache.getEntry(mintReviewsKey(MINT))?.data.score).toBe(4.5);
  hook.unmount();
  act(() => update?.({ ...first, tier: 'nagg', score: 2, reviewCount: 3 }));
  expect(store().getCached(MINT)).toMatchObject({ averageScore: 4.5, reviewCount: 90 });
  expect(mintReviewsCache.getEntry(mintReviewsKey(MINT))?.data.score).toBe(4.5);
});

it('records the per-mint auditor reads and shows the stats they carry', async () => {
  jest.mocked(readMintAuditDetail).mockResolvedValue({
    updates: [
      {
        source: 'ucash',
        observedAt: 1,
        uptime: { pct: 100, window: '24h', checks: 25 },
        latency: { ms: 3394, kind: 'mean', window: '24h' },
      },
    ],
    answered: true,
  });
  const { result } = renderHook(() => useMintDetailRead(MINT, { mintUrl: MINT }));
  await waitFor(() => expect(result.current.stats.uptime?.source).toBe('ucash'));
  // One source answering is an answer, even with the directory read failing.
  await waitFor(() => expect(result.current.audit).toBe('ready'));
  expect(result.current.stats.latency).toEqual({
    ms: 3394,
    kind: 'mean',
    window: '24h',
    source: 'ucash',
  });
  expect(readMintAuditDetail).toHaveBeenCalledWith(
    MINT,
    expect.objectContaining({ disabledAuditors: [], enabledAuditors: [] })
  );
});

it('waits for the saved mint rows to load before recording auditor readings', async () => {
  const reading = {
    source: 'ucash' as const,
    observedAt: 1,
    uptime: { pct: 100, window: '24h' as const, checks: 25 },
  };
  jest.mocked(readMintAuditDetail).mockResolvedValue({ updates: [reading], answered: true });
  let finish!: () => void;
  const loaded = jest.spyOn(useMintMetadataStore.persist, 'hasHydrated').mockReturnValue(false);
  const listen = jest
    .spyOn(useMintMetadataStore.persist, 'onFinishHydration')
    .mockImplementation((listener) => {
      finish = () => listener(useMintMetadataStore.getState());
      return () => {};
    });
  const record = jest.spyOn(store(), 'recordAuditObservations');
  try {
    renderHook(() => useMintDetailRead(MINT, { mintUrl: MINT }));
    await waitFor(() => expect(readMintAuditDetail).toHaveBeenCalled());
    await act(async () => {});
    // Written now, the empty in-memory store would be saved over the rows on disk.
    expect(record).not.toHaveBeenCalled();
    loaded.mockReturnValue(true);
    act(() => finish());
    await waitFor(() => expect(record).toHaveBeenCalledWith(MINT, [reading]));
  } finally {
    loaded.mockRestore();
    listen.mockRestore();
    record.mockRestore();
  }
});

it('drops auditor readings that land after Delete All', async () => {
  const { fenceDataReset } = jest.requireActual<
    typeof import('@/shared/lib/account/dataResetFence')
  >('@/shared/lib/account/dataResetFence');
  let answer!: (value: Awaited<ReturnType<typeof readMintAuditDetail>>) => void;
  jest.mocked(readMintAuditDetail).mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      })
  );
  const record = jest.spyOn(store(), 'recordAuditObservations');
  try {
    renderHook(() => useMintDetailRead(MINT, { mintUrl: MINT }));
    await waitFor(() => expect(readMintAuditDetail).toHaveBeenCalled());
    fenceDataReset();
    await act(async () =>
      answer({ updates: [{ source: 'ucash', observedAt: 1 }], answered: true })
    );
    expect(record).not.toHaveBeenCalled();
  } finally {
    record.mockRestore();
  }
});
