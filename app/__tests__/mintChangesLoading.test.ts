/**
 * The Mint history screen's data: revisions this phone recorded in
 * `mint-history-store`, its three states, and Retry / pull-to-refresh asking
 * the mint now. (Before ADR 0036 this read nagg's changelog.)
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useMintChangeRevisions } from '@/features/mint/hooks/useMintChanges';
import { checkMintInfoNow } from '@/features/mint/lib/mintHistorySync';
import { canonicalizeMintInfo } from '@/features/mint/lib/mintChanges/localDiff';
import { useMintHistoryStore } from '@/shared/stores/profile/mintHistoryStore';

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/features/mint/lib/mintHistorySync', () => ({ checkMintInfoNow: jest.fn() }));
jest.mock('@/shared/lib/errors', () => ({
  describeError: () => ({ text: 'Could not reach the mint.' }),
}));
jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return {
    log: { ...sink, child: () => sink },
    storeLog: sink,
    cashuLog: sink,
    apiLog: sink,
    redactError: (e: unknown) => e,
  };
});

const MINT = 'https://mint.sovran.money';
const doc = (over: Record<string, unknown> = {}) =>
  canonicalizeMintInfo({ name: 'Sovran', pubkey: '02ab', version: 'cdk-mintd/0.18.0', ...over })!;

beforeEach(async () => {
  jest.clearAllMocks();
  await useMintHistoryStore.persist.rehydrate();
  useMintHistoryStore.setState({ byMintUrl: {} });
  jest.mocked(checkMintInfoNow).mockResolvedValue({ ok: true });
});

it('waits for the first check, asking the mint once on open', async () => {
  const { result } = renderHook(() => useMintChangeRevisions(MINT));
  await waitFor(() => expect(checkMintInfoNow).toHaveBeenCalledTimes(1));
  expect(checkMintInfoNow).toHaveBeenCalledWith(MINT);
  await waitFor(() => expect(result.current.isRefreshing).toBe(false));
  expect(result.current.status).toBe('waiting');
  expect(result.current.revisions).toEqual([]);
});

it('says nothing changed once a baseline exists, without asking the mint again', async () => {
  useMintHistoryStore.getState().recordObservation(MINT, doc(), 1_000);
  const { result } = renderHook(() => useMintChangeRevisions(`${MINT}/`));
  await waitFor(() => expect(result.current.status).toBe('unchanged'));
  expect(checkMintInfoNow).not.toHaveBeenCalled();
});

it('phrases saved revisions newest first, each with its own id', async () => {
  const store = useMintHistoryStore.getState();
  store.recordObservation(MINT, doc(), 1_000);
  store.recordObservation(MINT, doc({ version: 'cdk-mintd/0.19.0' }), 2 * 3_600_000);
  store.recordObservation(MINT, doc(), 3 * 3_600_000);
  const { result } = renderHook(() => useMintChangeRevisions(MINT));
  await waitFor(() => expect(result.current.status).toBe('changed'));
  const { revisions } = result.current;
  expect(revisions).toHaveLength(2);
  expect(revisions[0]!.entry.at).toBe(3 * 3_600);
  expect(revisions[0]!.entry.sincePrevious).toBe(3_600);
  expect(new Set(revisions.map((r) => r.entry.hash)).size).toBe(2);
  expect(revisions[1]!.phrases.map((p) => p.detail ?? p.text).join(' ')).toMatch(/0\.19\.0/);
});

it('keeps the saved history on screen when a refresh fails, and says so', async () => {
  const store = useMintHistoryStore.getState();
  store.recordObservation(MINT, doc(), 1_000);
  store.recordObservation(MINT, doc({ motd: 'Maintenance tonight' }), 2 * 3_600_000);
  jest.mocked(checkMintInfoNow).mockResolvedValue({ ok: false, error: new Error('offline') });
  const { result } = renderHook(() => useMintChangeRevisions(MINT));
  await waitFor(() => expect(result.current.status).toBe('changed'));
  await act(async () => result.current.refresh());
  expect(checkMintInfoNow).toHaveBeenCalledWith(MINT);
  expect(result.current.errorMessage).toBe('Could not reach the mint.');
  expect(result.current.revisions).toHaveLength(1);
});

it('reports a failed background check from the saved bookkeeping', async () => {
  const store = useMintHistoryStore.getState();
  store.recordObservation(MINT, doc(), 1_000);
  store.recordFailure(MINT, 2_000, () => 0.5);
  const { result } = renderHook(() => useMintChangeRevisions(MINT));
  await waitFor(() => expect(result.current.status).toBe('unchanged'));
  expect(result.current.errorMessage).toMatch(/Couldn't reach this mint/);
});

it.each(['https://constructor', 'https://__proto__'])(
  'treats %s as a mint with no history yet, never an Object.prototype member',
  async (url) => {
    const { result } = renderHook(() => useMintChangeRevisions(url));
    await waitFor(() => expect(checkMintInfoNow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
    expect(result.current.status).toBe('waiting');
    expect(result.current.revisions).toEqual([]);
  }
);

it('marks a change whose details were too large to keep, so the page can say so', async () => {
  const store = useMintHistoryStore.getState();
  store.recordObservation(MINT, doc({ description: 'a'.repeat(10_000) }), 1_000);
  store.recordObservation(MINT, doc({ description: 'b'.repeat(10_000) }), 2 * 3_600_000);
  const { result } = renderHook(() => useMintChangeRevisions(MINT));
  await waitFor(() => expect(result.current.status).toBe('changed'));
  const [revision] = result.current.revisions;
  expect(revision!.entry.oversized).toBe(true);
  expect(revision!.phrases).toEqual([]);
});
