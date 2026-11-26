/**
 * Characterization of CocoProvider's background startup (phase 2): the order of
 * its steps, the wait for wallet restore, the stale-manager stop, and what a
 * failing recovery skips. The wallet manager, the app's Coco singleton, the
 * Routstr sweeps, the legacy claim and the default-mint setup are replaced by
 * recorders; the restore wait runs for real against the wallet lifecycle store.
 */

/* eslint-disable import/first */

const mockCalls: string[] = [];
const mockBgComplete = jest.fn();
const mockReport = jest.fn();
let mockSplashCompleted: boolean;
let mockCompleteSplash: ((completed: boolean) => void) | undefined;
let mockLiveInstance: unknown = null;
let mockManager: ReturnType<typeof mockMakeManager>;

function mockStep(name: string) {
  return jest.fn(async () => {
    mockCalls.push(name);
  });
}

function mockMakeManager() {
  return {
    ops: {
      receive: { recovery: { run: mockStep('receiveRecovery') } },
    },
  };
}

jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: {
    setSignerKey: () => undefined,
    initialize: async () => {
      mockLiveInstance = mockManager;
      return mockManager;
    },
    cleanup: async () => undefined,
    peekInstance: () => mockLiveInstance,
    warmSeedCache: async () => {
      mockCalls.push('seedCacheWarm');
    },
    startOperationRecovery: async () => {
      mockCalls.push('operationRecovery');
    },
    enableNpcSync: async () => {
      mockCalls.push('npcSync');
    },
  },
}));
jest.mock('@/shared/blocks/StartupFailedScreen', () => ({ StartupFailedScreen: () => null }));
jest.mock('@cashu/coco-react', () => ({
  CocoCashuProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/runtime/initializationStages', () => {
  const coco = {
    canStart: true,
    log: () => undefined,
    complete: () => undefined,
    error: () => undefined,
  };
  const background = {
    canStart: true,
    log: () => undefined,
    complete: () => mockBgComplete(),
    error: () => undefined,
  };
  return {
    useInitializationStage: (name: string) => (name === 'coco' ? coco : background),
  };
});
jest.mock('@/shared/providers/NostrKeysProvider', () => {
  const keys = { pubkey: 'ab'.repeat(32), privateKey: new Uint8Array(32).fill(9) };
  return { useNostrKeysContext: () => ({ keys, cashuMnemonic: null }) };
});
// The real logger, except that deferred work starts at once instead of after 50 ms.
jest.mock('@/shared/lib/logger', () => ({
  ...jest.requireActual('@/shared/lib/logger'),
  deferWork: (_name: string, work: () => unknown) => {
    void work();
    return { cancel: () => undefined };
  },
}));
jest.mock('@/shared/lib/cashu/legacyEcashClaim', () => ({
  startLegacyEcashClaim: () => mockCalls.push('legacyClaim'),
}));
jest.mock('@/shared/lib/routstr/reclaim', () => ({
  recoverPendingPayments: async () => {
    mockCalls.push('routstrPaymentRecovery');
  },
  reclaimRoutstrBalances: async () => {
    mockCalls.push('routstrReclaim');
  },
  recoverSdkRecords: async () => {
    mockCalls.push('routstrSdkRecords');
  },
}));
jest.mock('@/shared/lib/cashu/cocoFeedback', () => ({
  reportCocoApiFailure: (...args: unknown[]) => mockReport(...args),
}));
jest.mock('@/shared/lib/mintTestnutRefresh', () => ({
  attachMintTestnutToManager: () => () => undefined,
}));
jest.mock('@/features/mint/lib/mintHistorySync', () => ({
  attachMintHistoryToManager: () => () => undefined,
}));
jest.mock('@/shared/stores/global/mintMetadataStore', () => ({
  attachMintMetadataToManager: () => () => undefined,
}));
jest.mock('@/shared/lib/qrButtonAnchor', () => ({
  getBootMorphCompleted: () => mockSplashCompleted,
  subscribeBootMorphCompleted: (onCompleted: (completed: boolean) => void) => {
    mockCompleteSplash = onCompleted;
    return () => {
      mockCompleteSplash = undefined;
    };
  },
}));
jest.mock('@/shared/lib/cashu/initializeDefaultMints', () => ({
  initializeDefaultMints: jest.fn(async () => {
    mockCalls.push('defaultMints');
  }),
}));

import { act, render } from '@testing-library/react-native';

import { WalletCore } from '@/runtime/WalletCore';
import { initializeDefaultMints } from '@/shared/lib/cashu/initializeDefaultMints';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';

const FULL_ORDER = [
  'seedCacheWarm',
  'defaultMints',
  'operationRecovery',
  'npcSync',
  'receiveRecovery',
  'routstrPaymentRecovery',
  'routstrReclaim',
  'routstrSdkRecords',
  'legacyClaim',
];

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mountProvider() {
  const view = render(<WalletCore>{null}</WalletCore>);
  await settle();
  return view;
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  mockCalls.length = 0;
  mockBgComplete.mockClear();
  mockReport.mockClear();
  mockSplashCompleted = true;
  mockCompleteSplash = undefined;
  mockLiveInstance = null;
  mockManager = mockMakeManager();
  useWalletLifecycleStore.setState({ restoreStatus: 'not-needed' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('CocoProvider phase 2', () => {
  it('runs the background steps in a fixed order and then completes the stage', async () => {
    const view = await mountProvider();

    expect(mockCalls).toEqual(FULL_ORDER);
    expect(mockBgComplete).toHaveBeenCalledTimes(1);
    expect(jest.mocked(initializeDefaultMints)).toHaveBeenCalledWith(
      mockManager,
      expect.any(Function)
    );
    view.unmount();
  });

  it('waits for wallet restore before starting any Coco operation owners or NPC sync', async () => {
    useWalletLifecycleStore.setState({ restoreStatus: 'pending' });

    const view = await mountProvider();
    expect(mockCalls).toEqual(['seedCacheWarm', 'defaultMints']);
    expect(mockBgComplete).not.toHaveBeenCalled();

    await act(async () => {
      useWalletLifecycleStore.setState({ restoreStatus: 'complete' });
    });
    await settle();

    expect(mockCalls).toEqual(FULL_ORDER);
    expect(mockBgComplete).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('keeps waiting while the restore is in progress or failed', async () => {
    useWalletLifecycleStore.setState({ restoreStatus: 'in-progress' });
    const view = await mountProvider();

    await act(async () => {
      useWalletLifecycleStore.setState({ restoreStatus: 'failed' });
    });
    await settle();

    expect(mockCalls).toEqual(['seedCacheWarm', 'defaultMints']);
    view.unmount();
  });

  it('waits for the splash to finish even after 500 ms have elapsed', async () => {
    jest.useFakeTimers();
    mockSplashCompleted = false;
    try {
      const view = render(<WalletCore>{null}</WalletCore>);
      await act(async () => {});
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      expect(mockCalls).toEqual([]);
      await act(async () => {
        mockSplashCompleted = true;
        mockCompleteSplash?.(true);
      });
      expect(mockCalls).toEqual(FULL_ORDER);
      view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('still runs the Routstr recoveries when receive recovery throws', async () => {
    mockManager.ops.receive.recovery.run.mockImplementationOnce(async () => {
      mockCalls.push('receiveRecovery');
      throw new Error('receive recovery failed');
    });

    const view = await mountProvider();

    expect(mockCalls).toEqual(FULL_ORDER);
    expect(mockReport).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('stops the chain when the app manager is no longer the one phase 2 started with', async () => {
    jest.mocked(initializeDefaultMints).mockImplementationOnce(async () => {
      mockCalls.push('defaultMints');
      mockLiveInstance = { replaced: true };
    });

    const view = await mountProvider();

    expect(mockCalls).toEqual(['seedCacheWarm', 'defaultMints']);
    expect(mockBgComplete).not.toHaveBeenCalled();
    view.unmount();
  });

  it('completes the background stage and runs nothing more when an early step throws', async () => {
    jest.mocked(initializeDefaultMints).mockImplementationOnce(async () => {
      mockCalls.push('defaultMints');
      throw new Error('mint list unreadable');
    });

    const view = await mountProvider();

    expect(mockCalls).toEqual(['seedCacheWarm', 'defaultMints']);
    expect(mockReport).not.toHaveBeenCalled();
    expect(mockBgComplete).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
