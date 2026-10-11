/**
 * Retrying a wallet that failed to open. Closing the failed attempt clears the
 * staged wallet phrase and the imported flag, and only the signer key used to
 * be staged again, so an imported account's retry was opened as a derived one
 * and refused until the app was restarted.
 */

/* eslint-disable import/first */

const mockCalls: string[] = [];
let mockOnRetry: (() => void) | undefined;
const mockInitialize = jest.fn();

jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: {
    setSignerKey: () => mockCalls.push('signer'),
    setAccountIndex: (index: number, imported: boolean) =>
      mockCalls.push(`account:${index}:${imported}`),
    setCashuMnemonic: (phrase: string) => mockCalls.push(`phrase:${phrase}`),
    initialize: () => {
      mockCalls.push('initialize');
      return mockInitialize();
    },
    cleanup: async () => {
      mockCalls.push('cleanup');
    },
    peekInstance: () => null,
  },
}));
jest.mock('@/shared/blocks/StartupFailedScreen', () => ({
  StartupFailedScreen: ({ onRetry }: { onRetry: () => void }) => {
    mockOnRetry = onRetry;
    return null;
  },
}));
jest.mock('@cashu/coco-react', () => ({
  CocoCashuProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/shared/providers/InitializationProvider', () => {
  const stage = { canStart: true, log: jest.fn(), complete: jest.fn(), error: jest.fn() };
  return { useInitializationStage: () => stage };
});
jest.mock('@/shared/providers/NostrKeysProvider', () => {
  const keys = { pubkey: 'ab'.repeat(32), privateKey: new Uint8Array(32).fill(9) };
  return { useNostrKeysContext: () => ({ keys, cashuMnemonic: 'imported wallet phrase' }) };
});
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => ({ getActiveProfile: () => ({ accountIndex: 7, source: 'imported' }) }),
  },
}));
jest.mock('@/shared/stores/global/walletLifecycleStore', () => ({
  useWalletLifecycleStore: { getState: () => ({}) },
}));
jest.mock('@/shared/lib/logger', () => {
  const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    log,
    initLog: jest.fn(),
    initPhase: (_name: string, work: () => unknown) => work(),
    useInitMount: jest.fn(),
    deferWork: jest.fn(),
  };
});
jest.mock('@/shared/lib/cashu/legacyEcashClaim', () => ({ startLegacyEcashClaim: jest.fn() }));
jest.mock('@/shared/lib/routstr/reclaim', () => ({
  reclaimRoutstrBalances: jest.fn(),
  recoverPendingPayments: jest.fn(),
}));
jest.mock('@/shared/lib/routstr/sdk/client', () => ({ sweepUnsettledPayments: jest.fn() }));
jest.mock('@/shared/lib/cashu/cocoFeedback', () => ({ reportCocoApiFailure: jest.fn() }));
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
jest.mock('@/shared/providers/awaitRestoreReady', () => ({ awaitRestoreReady: jest.fn() }));
jest.mock('@/shared/lib/cashu/initializeDefaultMints', () => ({
  initializeDefaultMints: jest.fn(),
}));

import { act, render } from '@testing-library/react-native';

import { CocoProvider } from '@/shared/providers/CocoProvider';

it('stages the account and the wallet phrase again before a retry opens the wallet', async () => {
  mockInitialize.mockRejectedValueOnce(new Error('database is locked'));
  mockInitialize.mockReturnValue(new Promise(() => undefined));

  render(<CocoProvider>{null}</CocoProvider>);
  await act(async () => {});

  // The first attempt stages only the signer key: the keys provider staged the rest.
  expect(mockCalls).toEqual(['signer', 'initialize']);
  expect(mockOnRetry).toBeDefined();

  await act(async () => mockOnRetry!());

  expect(mockCalls).toEqual([
    'signer',
    'initialize',
    'cleanup',
    'account:7:true',
    'phrase:imported wallet phrase',
    'signer',
    'initialize',
  ]);
});
