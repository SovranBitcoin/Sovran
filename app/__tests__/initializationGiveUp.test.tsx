/**
 * @jest-environment node
 *
 * Exercise the real initialization stages, WalletCore (fake manager) and
 * create-profile flow. Holding the splash while deriving keys must leave
 * the outgoing wallet mounted so a failed derivation can return to it.
 */

/* eslint-disable import/first */

const mockCalls: string[] = [];

jest.mock('@react-native-async-storage/async-storage', () => {
  const disk: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => disk[k] ?? null,
      setItem: async (k: string, v: string) => {
        disk[k] = v;
      },
      removeItem: async (k: string) => {
        delete disk[k];
      },
      multiRemove: async (keys: string[]) => {
        for (const k of keys) delete disk[k];
      },
    },
  };
});
jest.mock('@/shared/lib/cashu/manager', () => {
  const manager = { id: 'manager' };
  return {
    CocoManager: {
      setSignerKey: () => mockCalls.push('signer'),
      setAccountIndex: () => mockCalls.push('account'),
      setCashuMnemonic: () => mockCalls.push('phrase'),
      initialize: async () => {
        mockCalls.push('initialize');
        return manager;
      },
      cleanup: async () => {
        mockCalls.push('cleanup');
      },
      isReadyForCleanup: () => true,
      getCleanupReadiness: () => ({ ready: true }),
      peekInstance: () => manager,
    },
  };
});
jest.mock('@/shared/blocks/StartupFailedScreen', () => ({
  StartupFailedScreen: () => 'startup failed screen',
}));
jest.mock('@cashu/coco-react', () => ({
  CocoCashuProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => {
  const keys = { pubkey: 'ab'.repeat(32), privateKey: new Uint8Array(32).fill(9) };
  return { useNostrKeysContext: () => ({ keys, cashuMnemonic: null }) };
});
jest.mock('@/shared/lib/cashu/legacyEcashClaim', () => ({ startLegacyEcashClaim: jest.fn() }));
jest.mock('@/shared/lib/routstr/reclaim', () => ({
  reclaimRoutstrBalances: jest.fn(),
  recoverPendingPayments: jest.fn(),
  recoverSdkRecords: jest.fn(),
}));
jest.mock('@/shared/lib/cashu/cocoFeedback', () => ({ reportCocoApiFailure: jest.fn() }));
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
  getBootMorphCompleted: () => false,
  subscribeBootMorphCompleted: () => () => undefined,
}));
jest.mock('@/runtime/awaitRestoreReady', () => ({ awaitRestoreReady: jest.fn() }));
jest.mock('@/shared/lib/cashu/initializeDefaultMints', () => ({
  initializeDefaultMints: jest.fn(),
}));

import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import {
  initializationStages,
  useInitializationStage,
  useInitializationState,
} from '@/runtime/initializationStages';

/** A fresh stage graph, as a freshly mounted app root starts with. */
function freshStageGraph() {
  act(() => {
    initializationStages.resetStages();
    initializationStages.cancelResetStages();
  });
}
beforeEach(freshStageGraph);
import { WalletCore } from '@/runtime/WalletCore';
import { createAndSwitchProfile } from '@/shared/lib/profile/profileSessionOrchestrator';
import { registerTransitionControls } from '@/shared/lib/profile/profileTransition';

let mockSplashUp: boolean | undefined;
let mockControls: typeof initializationStages | undefined;

/** Above the account providers, as GlobalMigrationGate and the registrar are. */
function Above({ children }: { children: React.ReactNode }) {
  const migrations = useInitializationStage('global-migrations');
  const controls = initializationStages;
  const { isInitializing } = useInitializationState();
  mockSplashUp = isInitializing;
  mockControls = controls;
  useEffect(() => registerTransitionControls(controls), [controls]);
  useEffect(() => {
    if (migrations.canStart) migrations.complete();
  }, [migrations]);
  return <>{children}</>;
}

/** Stands in for NostrKeysProvider's stage: completes as soon as it may start. */
function KeysStage({ children }: { children: React.ReactNode }) {
  const stage = useInitializationStage('nostr');
  useEffect(() => {
    if (stage.canStart) stage.complete();
  }, [stage]);
  return <>{children}</>;
}

function tree(account: number) {
  return (
    <>
      <Above>
        <React.Fragment key={`account-${account}`}>
          <KeysStage>
            <WalletCore>
              <Text>wallet home</Text>
            </WalletCore>
          </KeysStage>
        </React.Fragment>
      </Above>
    </>
  );
}

function walletShown(): boolean {
  return JSON.stringify(screen.toJSON() ?? null).includes('wallet home');
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function boot() {
  const view = render(tree(0));
  await settle();
  expect(walletShown()).toBe(true);
  expect(mockSplashUp).toBe(false);
  mockCalls.length = 0;
  return view;
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  mockCalls.length = 0;
  mockSplashUp = undefined;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a profile flow that gives up after raising the splash', () => {
  it('keeps the wallet open after a failed derivation', async () => {
    await boot();

    let result: boolean | undefined;
    await act(async () => {
      result = await createAndSwitchProfile({ getKeysForAccount: async () => null });
    });
    await settle();

    expect(result).toBe(false);
    expect(mockCalls).toEqual([]);
    expect(walletShown()).toBe(true);
    expect(mockSplashUp).toBe(false);
  });

  it('holds the splash up while the flow is deciding', async () => {
    await boot();
    let finishDerivation!: (keys: null) => void;
    const derivation = new Promise<null>((resolve) => {
      finishDerivation = resolve;
    });

    let flow: Promise<boolean> | undefined;
    await act(async () => {
      flow = createAndSwitchProfile({ getKeysForAccount: () => derivation });
    });
    await settle();

    expect(mockSplashUp).toBe(true);
    expect(walletShown()).toBe(true);
    expect(mockCalls).toEqual([]);

    await act(async () => {
      finishDerivation(null);
      await flow;
    });
    await settle();
    expect(mockSplashUp).toBe(false);
    expect(walletShown()).toBe(true);
  });
});

describe('a reset followed by the account providers remounting', () => {
  it('opens the wallet again for the new account', async () => {
    const view = await boot();

    // The in-process switch: keep the long-lived stages, remount below them.
    await act(async () => mockControls!.resetStages({ keepStagesThatOutliveAccount: true }));
    view.rerender(tree(1));
    await settle();
    await act(async () => mockControls!.cancelResetStages());
    await settle();

    expect(mockCalls).toEqual(['cleanup', 'signer', 'initialize']);
    expect(walletShown()).toBe(true);
    expect(mockSplashUp).toBe(false);
  });
});
