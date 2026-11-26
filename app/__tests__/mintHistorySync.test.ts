/* eslint-disable import/first */
// The observation seam, single-flight checks, profile fencing and the sweep.

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
let mockActive: string | undefined = 'a'.repeat(64);
jest.mock('@/shared/stores/global/profileStore', () => ({ activePubkey: () => mockActive }));
jest.mock('@/shared/lib/apiClient', () => ({ fetchMintInfo: jest.fn() }));
jest.mock('expo-network', () => ({ addNetworkStateListener: () => ({ remove: () => {} }) }));
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

import { err, ok } from 'neverthrow';
import {
  checkMintInfoNow,
  dueMintUrls,
  mintHistoryGeneration,
  observeMintInfoResponse,
  startMintHistorySweep,
  SWEEP_CONCURRENCY,
} from '@/features/mint/lib/mintHistorySync';
import { profileSwitchServices } from '@/shared/lib/account/accountRegistry';
import { fenceDataReset } from '@/shared/lib/account/dataResetFence';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { useMintHistoryStore } from '@/shared/stores/profile/mintHistoryStore';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const MINT = 'https://mint.sovran.money';
const raw = (over: Record<string, unknown> = {}) => ({
  name: 'Sovran',
  pubkey: '02ab',
  version: 'v1',
  time: Date.now(),
  ...over,
});
const held = (url = MINT) => useMintHistoryStore.getState().byMintUrl[normalizeMintUrlKey(url)];

beforeEach(async () => {
  mockActive = A;
  await useMintHistoryStore.persist.rehydrate();
  useMintHistoryStore.setState({ byMintUrl: {} });
});
afterEach(() => jest.useRealTimers());

describe('observeMintInfoResponse', () => {
  it('records a baseline, then only real changes', async () => {
    expect(await observeMintInfoResponse(MINT, raw())).toBe('baseline');
    expect(await observeMintInfoResponse(MINT, raw({ time: 1 }))).toBe('unchanged');
    expect(await observeMintInfoResponse(MINT, raw({ name: 'Sovran Mint' }))).toBe('changed');
    expect(held()?.revisions).toHaveLength(1);
  });

  it('ignores what is not a NUT-06 document', async () => {
    expect(await observeMintInfoResponse(MINT, 'nope')).toBe('skipped');
    expect(held()).toBeUndefined();
  });

  it('drops an answer that lands after the profile changed', async () => {
    const pending = observeMintInfoResponse(MINT, raw(), { owner: B });
    expect(await pending).toBe('skipped');
    expect(held()).toBeUndefined();
  });

  it('waits for the store to load before writing', async () => {
    let finish!: () => void;
    const spy = jest.spyOn(useMintHistoryStore.persist, 'hasHydrated').mockReturnValue(false);
    const unsub = jest
      .spyOn(useMintHistoryStore.persist, 'onFinishHydration')
      .mockImplementation((listener) => {
        finish = () => listener(useMintHistoryStore.getState());
        return () => {};
      });
    const pending = observeMintInfoResponse(MINT, raw());
    await Promise.resolve();
    expect(held()).toBeUndefined();
    spy.mockReturnValue(true);
    finish();
    expect(await pending).toBe('baseline');
    spy.mockRestore();
    unsub.mockRestore();
  });
});

describe('checkMintInfoNow', () => {
  it('joins a check already running for the same mint and profile', async () => {
    let resolve!: () => void;
    const fetch = jest.fn(
      () =>
        new Promise((r) => {
          resolve = () => r(ok({}));
        })
    );
    const first = checkMintInfoNow(MINT, { fetch: fetch as never });
    const second = checkMintInfoNow(`${MINT}/`, { fetch: fetch as never });
    expect(second).toBe(first);
    resolve();
    await expect(first).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    // Settled: the next check asks again.
    void checkMintInfoNow(MINT, { fetch: fetch as never });
    expect(fetch).toHaveBeenCalledTimes(2);
    resolve();
  });

  it('records a failure and keeps the saved baseline', async () => {
    await observeMintInfoResponse(MINT, raw());
    const fetch = jest.fn(async () => err(new Error('offline')));
    const result = await checkMintInfoNow(MINT, { fetch: fetch as never });
    expect(result.ok).toBe(false);
    expect(held()).toMatchObject({ consecutiveFailures: 1 });
    expect(held()?.baseline).toBeDefined();
  });
});

describe('background sweep', () => {
  it('checks due wallet mints, three at a time, and spares fresh ones', async () => {
    const urls = [
      'https://1.example',
      'https://2.example',
      'https://3.example',
      'https://4.example',
      MINT,
    ];
    await observeMintInfoResponse(MINT, raw()); // checked just now: not due
    let active = 0;
    let peak = 0;
    const checked: string[] = [];
    const check = jest.fn(async (url: string) => {
      active += 1;
      peak = Math.max(peak, active);
      checked.push(url);
      await new Promise((r) => setTimeout(r, 1));
      active -= 1;
      return { ok: true } as const;
    });
    jest.useFakeTimers();
    let resume!: () => void;
    const stop = startMintHistorySweep({
      trustedMintUrls: async () => urls,
      check,
      subscribeResume: (r) => {
        resume = r;
        return () => {};
      },
      startDelayMs: 60_000,
    });
    resume();
    // Each check takes 1 ms on the fake clock; 20 ms covers both rounds of three.
    await jest.advanceTimersByTimeAsync(20);
    expect(checked.sort()).toEqual(urls.slice(0, 4).sort());
    expect(peak).toBeLessThanOrEqual(SWEEP_CONCURRENCY);
    expect(held(MINT)?.trusted).toBe(true);
    stop();
  });

  it('stops on a profile switch, and a sweep started for another profile writes nothing', async () => {
    jest.useFakeTimers();
    const check = jest.fn(async () => ({ ok: true }) as const);
    let resume!: () => void;
    startMintHistorySweep({
      trustedMintUrls: async () => [MINT],
      check,
      subscribeResume: (r) => {
        resume = r;
        return () => {};
      },
      startDelayMs: 60_000,
    });
    const stopForSwitch = profileSwitchServices().get('mint.history.sweep');
    expect(stopForSwitch).toBeDefined();
    await stopForSwitch!();
    resume();
    await jest.advanceTimersByTimeAsync(5);
    expect(check).not.toHaveBeenCalled();

    // Started for A, the active profile is now B: nothing runs.
    const stop = startMintHistorySweep({
      trustedMintUrls: async () => [MINT],
      check,
      subscribeResume: (r) => {
        resume = r;
        return () => {};
      },
      startDelayMs: 60_000,
    });
    mockActive = B;
    resume();
    await jest.advanceTimersByTimeAsync(5);
    expect(check).not.toHaveBeenCalled();
    stop();
  });

  it('waits out the backoff of a mint that failed its first check', () => {
    const now = 1_000_000;
    useMintHistoryStore.getState().recordFailure(MINT, now, () => 0.5);
    expect(held()?.baseline).toBeUndefined();
    expect(dueMintUrls([MINT], now + 60_000)).toEqual([]);
    expect(dueMintUrls([MINT], now + 5 * 60_000)).toEqual([MINT]);
  });

  it('treats a mint with no baseline, or past its retry time, as due', async () => {
    await observeMintInfoResponse(MINT, raw());
    const now = Date.now();
    expect(dueMintUrls([MINT, 'https://new.example'], now)).toEqual(['https://new.example']);
    expect(dueMintUrls([MINT], now + 25 * 3_600_000)).toEqual([MINT]);
  });
});

describe('session fence', () => {
  /** Holds the store "loading" until the returned function is called. */
  function holdLoad() {
    let finish!: () => void;
    const loaded = jest.spyOn(useMintHistoryStore.persist, 'hasHydrated').mockReturnValue(false);
    const listen = jest
      .spyOn(useMintHistoryStore.persist, 'onFinishHydration')
      .mockImplementation((listener) => {
        finish = () => listener(useMintHistoryStore.getState());
        return () => {};
      });
    return () => {
      loaded.mockReturnValue(true);
      finish();
      loaded.mockRestore();
      listen.mockRestore();
    };
  }
  const sweep = () =>
    startMintHistorySweep({
      trustedMintUrls: async () => [],
      check: jest.fn(),
      subscribeResume: () => () => {},
      startDelayMs: 60_000,
    });

  it('drops an answer for A that lands after A → B → A', async () => {
    const release = holdLoad();
    const pending = observeMintInfoResponse(MINT, raw());
    await Promise.resolve();
    sweep()(); // switch away from A
    mockActive = B;
    sweep()(); // and back
    mockActive = A;
    release();
    expect(await pending).toBe('skipped');
    expect(held()).toBeUndefined();
  });

  it('forgets a running check on stop, and its failure writes nothing', async () => {
    const answers: ((value: unknown) => void)[] = [];
    const fetch = jest.fn(() => new Promise((r) => answers.push(r)));
    const first = checkMintInfoNow(MINT, { fetch: fetch as never });
    sweep()();
    const second = checkMintInfoNow(MINT, { fetch: fetch as never });
    expect(second).not.toBe(first);
    expect(fetch).toHaveBeenCalledTimes(2);
    answers[0]!(err(new Error('offline')));
    await first;
    expect(held()).toBeUndefined();
    answers[1]!(ok({}));
    await second;
  });

  it('drops an answer whose request began in an earlier session, as fetchMintInfo passes it', async () => {
    const began = mintHistoryGeneration();
    sweep()();
    expect(mintHistoryGeneration()).toBe(began + 1);
    fenceDataReset();
    expect(mintHistoryGeneration()).toBe(began + 2);
    expect(await observeMintInfoResponse(MINT, raw(), { owner: A, generation: began })).toBe(
      'skipped'
    );
    expect(held()).toBeUndefined();
  });

  it('drops an answer that lands after Delete All', async () => {
    const release = holdLoad();
    const pending = observeMintInfoResponse(MINT, raw());
    await Promise.resolve();
    fenceDataReset();
    release();
    expect(await pending).toBe('skipped');
    expect(held()).toBeUndefined();
  });
});
