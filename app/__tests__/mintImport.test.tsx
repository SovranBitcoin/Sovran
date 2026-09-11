import { act, renderHook } from '@testing-library/react-native';
import { useMintImport } from '@/features/mint/hooks/useMintImport';

const mockManager = { mint: { addMint: jest.fn() }, wallet: { restore: jest.fn() } };
let mockCurrentManager = mockManager;
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: {
    getInstance: () => mockCurrentManager,
    isInitialized: () => true,
  },
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn() },
  cashuLog: { debug: jest.fn() },
  mintUrlLogFields: () => ({}),
}));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  mockCurrentManager = mockManager;
  mockManager.mint.addMint.mockReset().mockResolvedValue(undefined);
  mockManager.wallet.restore.mockReset().mockResolvedValue(undefined);
});

test('shows each operation immediately, ignores double taps, and waits for restoration', async () => {
  const add = deferred();
  const restore = deferred();
  mockManager.mint.addMint.mockReturnValue(add.promise);
  mockManager.wallet.restore.mockReturnValue(restore.promise);
  const { result } = renderHook(useMintImport);
  let completion!: Promise<void>;
  act(() => {
    completion = result.current.start(['mint.example']);
    void result.current.start(['mint.example']);
  });
  expect(result.current.state).toEqual({
    running: true,
    items: [{ url: 'https://mint.example', stage: 'adding' }],
  });
  expect(mockManager.mint.addMint).toHaveBeenCalledTimes(1);
  expect(mockManager.wallet.restore).not.toHaveBeenCalled();
  await act(async () => {
    add.resolve();
  });
  expect(result.current.state?.items[0].stage).toBe('restoring');
  act(() => result.current.dismiss());
  expect(result.current.state?.running).toBe(true);
  await act(async () => {
    restore.resolve();
    await completion;
  });
  expect(result.current.state).toEqual({
    running: false,
    items: [{ url: 'https://mint.example', stage: 'complete' }],
  });
});

test('preserves partial success and distinguishes failed recovery from failed import', async () => {
  mockManager.mint.addMint.mockRejectedValueOnce(new Error('offline'));
  mockManager.wallet.restore.mockRejectedValueOnce(new Error('restore unavailable'));
  const { result } = renderHook(useMintImport);
  await act(async () => {
    await result.current.start(['fail.example', 'restore.example', 'ready.example']);
  });
  expect(result.current.state?.items.map((item) => item.stage)).toEqual([
    'failed',
    'restore-failed',
    'complete',
  ]);
  expect(mockManager.wallet.restore.mock.calls.map(([url]) => url)).toEqual([
    'https://restore.example',
    'https://ready.example',
  ]);
});

test('deduplicates normalized URLs without overlapping mint operations', async () => {
  const { result } = renderHook(useMintImport);
  await act(async () => {
    await result.current.start(['mint.example', 'https://mint.example']);
  });
  expect(mockManager.mint.addMint).toHaveBeenCalledTimes(1);
  expect(mockManager.mint.addMint).toHaveBeenCalledWith('https://mint.example', { trusted: true });
});

test('does not start restoration or the next mint after a profile switch', async () => {
  const add = deferred();
  mockManager.mint.addMint.mockReturnValue(add.promise);
  const { result } = renderHook(useMintImport);
  let completion!: Promise<void>;
  act(() => {
    completion = result.current.start(['first.example', 'second.example']);
  });
  mockCurrentManager = { mint: { addMint: jest.fn() }, wallet: { restore: jest.fn() } };
  await act(async () => {
    add.resolve();
    await completion;
  });
  expect(mockManager.wallet.restore).not.toHaveBeenCalled();
  expect(mockManager.mint.addMint).toHaveBeenCalledTimes(1);
  expect(mockCurrentManager.wallet.restore).not.toHaveBeenCalled();
  expect(result.current.state?.running).toBe(false);
  expect(result.current.state?.items.map((item) => item.stage)).toEqual([
    'restore-failed',
    'failed',
  ]);
});

test('finishes an initiated import without navigating or starting a new screen after unmount', async () => {
  const add = deferred();
  mockManager.mint.addMint.mockReturnValue(add.promise);
  const { result, unmount } = renderHook(useMintImport);
  let completion!: Promise<void>;
  act(() => {
    completion = result.current.start(['mint.example']);
  });
  unmount();
  await act(async () => {
    add.resolve();
    await completion;
  });
  expect(mockManager.wallet.restore).toHaveBeenCalledWith('https://mint.example');
});
