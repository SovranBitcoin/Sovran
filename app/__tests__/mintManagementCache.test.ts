/**
 * @jest-environment node
 *
 * `useMintManagement`'s trusted-mint list and its module-level cache: what a
 * first and a warm mount show, how concurrent consumers share one load, which
 * wallet events reload the list (and how recovery defers them), what a failed
 * load leaves, what the account reset clears, and what happens when two
 * Managers' loads overlap.
 *
 * The real hook, account registry and recovery suppression run. The Coco
 * Manager from `useManager` is a fake recording its trusted-mint reads and
 * event subscriptions. Mint info goes through a pass-through cache.
 */
import { act, renderHook } from '@testing-library/react-native';
import type { Mint } from '@cashu/coco-core';

import { useMintManagement } from '@/features/mint/hooks/useMintManagement';
import { accountHolders } from '@/shared/lib/account/accountRegistry';
import {
  beginRecoverySuppression,
  endRecoverySuppression,
} from '@/shared/lib/cashu/recoverySuppression';

type Listener = () => void;
function makeManager(name: string) {
  const listeners = new Map<string, Set<Listener>>();
  return {
    name,
    mint: {
      getAllTrustedMints: jest.fn(async (): Promise<Mint[]> => []),
      getMintInfo: jest.fn(async (url: string) => ({ name: `info for ${url}` })),
    },
    on: jest.fn((event: string, fn: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    }),
    off: jest.fn((event: string, fn: Listener) => listeners.get(event)?.delete(fn)),
    emit: (event: string) => listeners.get(event)?.forEach((fn) => fn()),
    listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}
type FakeManager = ReturnType<typeof makeManager>;

let mockManager: FakeManager;
jest.mock('@cashu/coco-react', () => ({ useManager: () => mockManager }));
jest.mock('@/shared/stores/global/mintMetadataStore', () => ({
  getCachedMintInfo: (fetcher: (url: string) => Promise<unknown>, url: string) => fetcher(url),
}));
jest.mock('@/shared/lib/logger', () => {
  const log: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const named: Record<string, unknown> = {
    mintUrlLogFields: () => ({}),
    redactError: (e: unknown) => e,
  };
  return new Proxy(named, { get: (target, key: string) => (key in target ? target[key] : log) });
});

function mint(url: string): Mint {
  const value = { mintUrl: url, trusted: true };
  return value as unknown as Mint;
}
const urls = (mints: Mint[]) => mints.map((m) => m.mintUrl);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const holder = () => accountHolders.find((h) => h.name === 'mint.management-cache')!;
const flush = () => act(async () => undefined);

beforeEach(async () => {
  await holder().dispose();
  mockManager = makeManager('A');
});

describe('loading the trusted mints', () => {
  it('a first mount shows loading, reads the trusted mints once and shows them', async () => {
    const load = deferred<Mint[]>();
    mockManager.mint.getAllTrustedMints.mockReturnValueOnce(load.promise);

    const { result } = renderHook(() => useMintManagement());
    await flush();
    expect(result.current).toMatchObject({ mints: [], isLoading: true });

    await act(async () => load.resolve([mint('https://a.example')]));

    expect(mockManager.mint.getAllTrustedMints).toHaveBeenCalledTimes(1);
    expect(urls(result.current.mints)).toEqual(['https://a.example']);
    expect(result.current.isLoading).toBe(false);
  });

  it('consumers mounting together share one read', async () => {
    const load = deferred<Mint[]>();
    mockManager.mint.getAllTrustedMints.mockReturnValueOnce(load.promise);

    const first = renderHook(() => useMintManagement());
    const second = renderHook(() => useMintManagement());
    await act(async () => load.resolve([mint('https://a.example')]));

    expect(mockManager.mint.getAllTrustedMints).toHaveBeenCalledTimes(1);
    expect(urls(first.result.current.mints)).toEqual(['https://a.example']);
    expect(urls(second.result.current.mints)).toEqual(['https://a.example']);
  });

  it('a later mount for the same Manager shows the last list at once and refreshes it without a loading state', async () => {
    mockManager.mint.getAllTrustedMints.mockResolvedValueOnce([mint('https://a.example')]);
    renderHook(() => useMintManagement()).unmount();
    await flush();
    const refresh = deferred<Mint[]>();
    mockManager.mint.getAllTrustedMints.mockReturnValueOnce(refresh.promise);

    const { result } = renderHook(() => useMintManagement());
    expect(urls(result.current.mints)).toEqual(['https://a.example']);
    await flush();
    expect(result.current.isLoading).toBe(false);

    await act(async () => refresh.resolve([mint('https://a.example'), mint('https://b.example')]));
    expect(urls(result.current.mints)).toEqual(['https://a.example', 'https://b.example']);
    expect(mockManager.mint.getAllTrustedMints).toHaveBeenCalledTimes(2);
  });

  it('a mount for another Manager starts empty and loading, never with the other list', async () => {
    mockManager.mint.getAllTrustedMints.mockResolvedValueOnce([mint('https://a.example')]);
    renderHook(() => useMintManagement()).unmount();
    await flush();

    mockManager = makeManager('B');
    const load = deferred<Mint[]>();
    mockManager.mint.getAllTrustedMints.mockReturnValueOnce(load.promise);
    const { result } = renderHook(() => useMintManagement());
    expect(result.current.mints).toEqual([]);
    await flush();
    expect(result.current.isLoading).toBe(true);

    await act(async () => load.resolve([mint('https://b.example')]));
    expect(urls(result.current.mints)).toEqual(['https://b.example']);
  });

  it('a failed read keeps the list it had and stops loading', async () => {
    mockManager.mint.getAllTrustedMints.mockResolvedValueOnce([mint('https://a.example')]);
    const { result } = renderHook(() => useMintManagement());
    await flush();
    mockManager.mint.getAllTrustedMints.mockRejectedValueOnce(new Error('db closed'));

    await act(async () => {
      await result.current.loadMints('manual');
    });

    expect(urls(result.current.mints)).toEqual(['https://a.example']);
    expect(result.current.isLoading).toBe(false);
  });

  it('getMintInfo reads through the mint info cache and rethrows a failure', async () => {
    const { result } = renderHook(() => useMintManagement());
    await flush();

    await expect(result.current.getMintInfo('https://a.example')).resolves.toEqual({
      name: 'info for https://a.example',
    });
    mockManager.mint.getMintInfo.mockRejectedValueOnce(new Error('offline'));
    await expect(result.current.getMintInfo('https://a.example')).rejects.toThrow('offline');
  });
});

describe('wallet events and adding or removing a mint', () => {
  it.each(['mint:added', 'mint:updated', 'mint:trusted', 'mint:untrusted'])(
    '%s reloads the list',
    async (event) => {
      const { result } = renderHook(() => useMintManagement());
      await flush();
      mockManager.mint.getAllTrustedMints.mockResolvedValueOnce([mint('https://new.example')]);

      await act(async () => mockManager.emit(event));

      expect(mockManager.mint.getAllTrustedMints).toHaveBeenCalledTimes(2);
      expect(urls(result.current.mints)).toEqual(['https://new.example']);
    }
  );

  it('removing a mint (untrusted) shows the shorter list and updates the cache for the next mount', async () => {
    mockManager.mint.getAllTrustedMints.mockResolvedValueOnce([
      mint('https://a.example'),
      mint('https://b.example'),
    ]);
    const { result, unmount } = renderHook(() => useMintManagement());
    await flush();
    mockManager.mint.getAllTrustedMints.mockResolvedValue([mint('https://a.example')]);

    await act(async () => mockManager.emit('mint:untrusted'));
    expect(urls(result.current.mints)).toEqual(['https://a.example']);
    unmount();

    const next = renderHook(() => useMintManagement());
    expect(urls(next.result.current.mints)).toEqual(['https://a.example']);
    await flush();
  });

  it('during recovery, events are held and replayed as one reload when recovery ends', async () => {
    renderHook(() => useMintManagement());
    await flush();
    beginRecoverySuppression();
    try {
      await act(async () => {
        mockManager.emit('mint:added');
        mockManager.emit('mint:trusted');
        mockManager.emit('mint:updated');
      });
      expect(mockManager.mint.getAllTrustedMints).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => endRecoverySuppression());
    }

    expect(mockManager.mint.getAllTrustedMints).toHaveBeenCalledTimes(2);
  });

  it('unmount stops listening', async () => {
    const { unmount } = renderHook(() => useMintManagement());
    await flush();
    expect(mockManager.listenerCount()).toBe(4);

    unmount();

    expect(mockManager.listenerCount()).toBe(0);
  });
});

describe('the account reset and overlapping Managers', () => {
  it('the account reset waits for a read in flight, then forgets the cached list', async () => {
    const load = deferred<Mint[]>();
    mockManager.mint.getAllTrustedMints.mockReturnValueOnce(load.promise);
    renderHook(() => useMintManagement()).unmount();
    expect(holder().inspect!()).toBe(false);

    let disposed = false;
    const disposing = Promise.resolve(holder().dispose()).then(() => {
      disposed = true;
    });
    await flush();
    expect(disposed).toBe(false);
    await act(async () => {
      load.resolve([mint('https://a.example')]);
      await disposing;
    });

    expect(holder().inspect!()).toBe(true);
    const next = renderHook(() => useMintManagement());
    expect(next.result.current.mints).toEqual([]);
    await flush();
  });

  it('a new Manager mounting while the old one’s read is in flight joins it and keeps the old list', async () => {
    const oldManager = mockManager;
    const oldLoad = deferred<Mint[]>();
    oldManager.mint.getAllTrustedMints.mockReturnValueOnce(oldLoad.promise);
    renderHook(() => useMintManagement()).unmount();

    mockManager = makeManager('B');
    mockManager.mint.getAllTrustedMints.mockResolvedValue([mint('https://b.example')]);
    const { result } = renderHook(() => useMintManagement());
    await act(async () => oldLoad.resolve([mint('https://old-account.example')]));

    // QUIRK: the shared read is not keyed by Manager, so without the account
    // reset in between, the new Manager shows (and caches) the old one's mints.
    expect(mockManager.mint.getAllTrustedMints).not.toHaveBeenCalled();
    expect(urls(result.current.mints)).toEqual(['https://old-account.example']);
    const warm = renderHook(() => useMintManagement());
    expect(urls(warm.result.current.mints)).toEqual(['https://old-account.example']);
    await flush();
  });
});
