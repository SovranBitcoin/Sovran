/**
 * The catalog fetch has to be recoverable.
 *
 * `/v1/models` is read in exactly one place in the app, and its rejection used
 * to land in a bare `.catch(() => {})` inside `ModelChip`'s effect. Nothing in
 * that effect's dependencies moves when a request fails, so the first failure
 * was also the last attempt: the lineup stayed null until the component
 * remounted or the user changed node. A user pinned to one provider had
 * neither — the nagg lineup path correctly declines a lineup derived for a
 * different node, so the catalog read is the only thing that could have
 * repaired the menu, and it had quietly stopped trying.
 *
 * These cases pin the owner that replaced it: it retries on a finite ladder,
 * it says so in the log every time, it stops rather than loop, and it drops
 * every pending timer when its host goes away.
 */
import { act, renderHook } from '@testing-library/react-native';

import { useModelCatalog } from '@/features/ai/hooks/useModelCatalog';
import { getModels, type RoutstrModel } from '@/shared/lib/routstr/api';
import { aiLog } from '@/shared/lib/logger';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

jest.mock('@/shared/lib/routstr/api', () => ({
  getModels: jest.fn(),
  setRoutstrNodeBaseUrl: jest.fn(),
  ROUTSTR_MAX_COMPLETION_TOKENS: 4096,
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: { getState: () => ({ activeAccountIndex: 0 }) },
}));
jest.mock('@/shared/lib/routstr/securePersistence', () => ({
  createRoutstrPersistence: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/routstr/secureVault', () => ({
  createSecureVault: () => ({ read: async () => null, write: async () => {} }),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  captureProfileStorageOwner: async () => 'a'.repeat(64),
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/logger', () => {
  const entry = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    apiLog: entry,
    aiLog: entry,
    storeLog: entry,
    log: { ...entry, child: () => entry },
    useMountLog: () => {},
    applyFileLogging: jest.fn(),
    redactError: (error: unknown) => error,
  };
});

/**
 * The hook's foreground trigger is captured rather than exercised: what it
 * does with app/screen activity belongs to `useVisualActivityEffect`'s own
 * contract, and driving AppState here would test that module instead of this
 * one. Calling the captured effect IS the foreground event, from this hook's
 * point of view.
 */
let onVisible: (() => void) | null = null;
jest.mock('@/shared/hooks/useVisualActivityEffect', () => ({
  useVisualActivityEffect: (effect: () => void) => {
    onVisible = effect;
  },
}));

const getModelsMock = jest.mocked(getModels);
const warnMock = jest.mocked(aiLog.warn);

/** One usable catalog row — the lineup derivation is not what is under test. */
const catalog: RoutstrModel[] = [
  {
    id: 'gpt-5.4-nano',
    name: 'OpenAI: GPT-5.4 nano',
    canonical_slug: 'openai/gpt-5.4-nano',
    enabled: true,
    context_length: 128_000,
    created: 1_780_000_000,
    architecture: { output_modalities: ['text'], input_modalities: ['text'] },
    sats_pricing: { prompt: 0.00001, completion: 0.00004, request: 0, image: 0, max_cost: 10 },
  } as unknown as RoutstrModel,
];

/** Lets the rejected fetch's `.catch` and any state it sets settle. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

/** Runs the timers the ladder scheduled, then settles the attempt they fired. */
const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
};

describe('catalog fetch retry owner', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    onVisible = null;
    await useRoutstrStore.persist.rehydrate();
    useRoutstrStore.setState({
      nodeBaseUrl: 'https://node.example',
      userNodeBaseUrl: 'https://node.example',
      modelsCache: null,
      lineup: null,
      lastKnownLineup: null,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries a failed first fetch and lands the catalog without a remount', async () => {
    getModelsMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(catalog);

    const hook = renderHook(useModelCatalog);
    await settle();
    // The old behaviour stopped here, for the rest of the session.
    expect(getModelsMock).toHaveBeenCalledTimes(1);
    expect(useRoutstrStore.getState().modelsCache).toBeNull();

    await advance(2_000);

    expect(getModelsMock).toHaveBeenCalledTimes(2);
    expect(useRoutstrStore.getState().modelsCache?.data).toEqual(catalog);
    expect(hook.result.current).toEqual(catalog);
    hook.unmount();
  });

  it('says what happened instead of swallowing it', async () => {
    getModelsMock.mockRejectedValue(new Error('offline'));
    const hook = renderHook(useModelCatalog);
    await settle();

    expect(warnMock).toHaveBeenCalledWith(
      'ai.catalog.fetch_failed',
      expect.objectContaining({
        nodeBaseUrl: 'https://node.example',
        attempt: 1,
        retryInMs: 2_000,
        error: expect.anything(),
      })
    );
    hook.unmount();
  });

  it('stops at the end of the ladder rather than asking forever', async () => {
    getModelsMock.mockRejectedValue(new Error('offline'));
    const hook = renderHook(useModelCatalog);
    await settle();

    for (const delay of [2_000, 5_000, 15_000, 60_000, 300_000]) await advance(delay);
    expect(getModelsMock).toHaveBeenCalledTimes(6);

    // An hour later, still six. A node that refused six times over six minutes
    // is not one more request away, and a timer that never stops is a battery
    // cost the user never agreed to.
    await advance(60 * 60 * 1000);
    expect(getModelsMock).toHaveBeenCalledTimes(6);
    hook.unmount();
  });

  it('gives a spent ladder one fresh run when the screen comes back', async () => {
    getModelsMock.mockRejectedValue(new Error('offline'));
    const hook = renderHook(useModelCatalog);
    await settle();
    for (const delay of [2_000, 5_000, 15_000, 60_000, 300_000]) await advance(delay);
    expect(getModelsMock).toHaveBeenCalledTimes(6);

    getModelsMock.mockResolvedValueOnce(catalog);
    await act(async () => {
      onVisible?.();
      await Promise.resolve();
    });

    expect(getModelsMock).toHaveBeenCalledTimes(7);
    expect(useRoutstrStore.getState().modelsCache?.data).toEqual(catalog);
    hook.unmount();
  });

  it('does not restart a ladder that is still running', async () => {
    getModelsMock.mockRejectedValue(new Error('offline'));
    const hook = renderHook(useModelCatalog);
    await settle();
    expect(getModelsMock).toHaveBeenCalledTimes(1);

    // Two foreground events mid-ladder must not fan out into two ladders.
    await act(async () => {
      onVisible?.();
      onVisible?.();
      await Promise.resolve();
    });
    expect(getModelsMock).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it('drops its pending retry when its host goes away', async () => {
    getModelsMock.mockRejectedValue(new Error('offline'));
    const hook = renderHook(useModelCatalog);
    await settle();
    expect(getModelsMock).toHaveBeenCalledTimes(1);

    hook.unmount();
    await advance(300_000);
    expect(getModelsMock).toHaveBeenCalledTimes(1);
  });
});
