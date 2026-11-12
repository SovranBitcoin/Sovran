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
      send: { recovery: { run: mockStep('sendRecovery') } },
      melt: { recovery: { run: mockStep('meltRecovery') } },
      receive: { recovery: { run: mockStep('receiveRecovery') } },
    },
    recoverPendingPaymentRequestReceiveAttempts: mockStep('paymentRequestRecovery'),
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
    enableSafeWatchers: async () => {
      mockCalls.push('safeWatchers');
    },
    enableNpcSyncAndProcessor: async () => {
      mockCalls.push('npcSync');
    },
  },
}));
jest.mock('@/shared/blocks/StartupFailedScreen', () => ({ StartupFailedScreen: () => null }));
jest.mock('@cashu/coco-react', () => ({
  CocoCashuProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/shared/providers/InitializationProvider', () => {
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
}));
jest.mock('@/shared/lib/routstr/sdk/client', () => ({
  sweepUnsettledPayments: async () => {
    mockCalls.push('routstrSdkSweep');
  },
}));
jest.mock('@/shared/lib/cashu/cocoFeedback', () => ({
  reportCocoApiFailure: (...args: unknown[]) => mockReport(...args),
}));
jest.mock('@/shared/lib/mintTestnutRefresh', () => ({
  attachMintTestnutToManager: () => () => undefined,
}));
jest.mock('@/shared/stores/global/mintMetadataStore', () => ({
  attachMintMetadataToManager: () => () => undefined,
}));
jest.mock('@/shared/lib/qrButtonAnchor', () => ({
  getBootMorphCompleted: () => true,
  subscribeBootMorphCompleted: () => () => undefined,
}));
jest.mock('@/shared/lib/cashu/initializeDefaultMints', () => ({
  initializeDefaultMints: jest.fn(async () => {
    mockCalls.push('defaultMints');
  }),
}));

import { act, render } from '@testing-library/react-native';

import { CocoProvider } from '@/shared/providers/CocoProvider';
import { initializeDefaultMints } from '@/shared/lib/cashu/initializeDefaultMints';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';

const FULL_ORDER = [
  'safeWatchers',
  'defaultMints',
  'npcSync',
  'sendRecovery',
  'meltRecovery',
  'receiveRecovery',
  'paymentRequestRecovery',
  'routstrPaymentRecovery',
  'routstrSdkSweep',
  'routstrReclaim',
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
  const view = render(<CocoProvider>{null}</CocoProvider>);
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

    // QUIRK: the Routstr change recovery runs after the send, melt, receive and NUT-18
    // recoveries although its comment says it "runs first" because it has a deadline
    // (stores-persistence D3). A reorder should change this assertion on purpose.
    expect(mockCalls).toEqual(FULL_ORDER);
    expect(mockBgComplete).toHaveBeenCalledTimes(1);
    expect(jest.mocked(initializeDefaultMints)).toHaveBeenCalledWith(
      mockManager,
      expect.any(Function)
    );
    view.unmount();
  });

  it('waits for the wallet restore before NPC sync and every recovery', async () => {
    useWalletLifecycleStore.setState({ restoreStatus: 'pending' });

    const view = await mountProvider();
    // QUIRK: the safe watchers and the default mints run while restore is still pending;
    // only what follows waits. Moving them behind the wait should change this on purpose.
    expect(mockCalls).toEqual(['safeWatchers', 'defaultMints']);
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

    expect(mockCalls).toEqual(['safeWatchers', 'defaultMints']);
    view.unmount();
  });

  it('still runs every later recovery when send recovery throws', async () => {
    const failure = new Error('Recovery is already in progress');
    mockManager.ops.send.recovery.run.mockImplementationOnce(async () => {
      mockCalls.push('sendRecovery');
      throw failure;
    });

    const view = await mountProvider();

    expect(mockCalls).toEqual(FULL_ORDER);
    expect(mockReport).toHaveBeenCalledWith('ops.*.recovery.run', failure);
    expect(mockBgComplete).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('still runs the receive and Routstr recoveries when melt recovery throws', async () => {
    mockManager.ops.melt.recovery.run.mockImplementationOnce(async () => {
      mockCalls.push('meltRecovery');
      throw new Error('melt recovery failed');
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

    expect(mockCalls).toEqual(['safeWatchers', 'defaultMints']);
    expect(mockBgComplete).not.toHaveBeenCalled();
    view.unmount();
  });

  it('completes the background stage and runs nothing more when an early step throws', async () => {
    jest.mocked(initializeDefaultMints).mockImplementationOnce(async () => {
      mockCalls.push('defaultMints');
      throw new Error('mint list unreadable');
    });

    const view = await mountProvider();

    expect(mockCalls).toEqual(['safeWatchers', 'defaultMints']);
    expect(mockReport).not.toHaveBeenCalled();
    expect(mockBgComplete).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
