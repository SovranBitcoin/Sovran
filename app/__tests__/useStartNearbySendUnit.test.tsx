/**
 * The nearby-send hook is mounted by the Send screen. It must not pin the
 * payment machine's unit: a pin lasts as long as the hook is mounted, and sat
 * would then be the unit of every flow started from Send in another account.
 */

/* eslint-disable import/first */

const mockBindings: Record<string, unknown>[] = [];
const mockStartSendEcash = jest.fn();
let mockActiveUnit = 'sat';
const mockNeedsBitcoinAccount = jest.fn();

jest.mock('wallet/react', () => ({
  usePaymentFlowMachine: (config: Record<string, unknown>) => {
    mockBindings.push(config);
    return { startSendEcash: mockStartSendEcash };
  },
}));
jest.mock('wallet', () => ({
  accountMintUrls: () => ['https://mint.example'],
  toRealUnit: (unit: string) => unit,
}));
jest.mock('@/shared/providers/WalletContextProvider', () => ({
  useWalletContext: () => ({ trustedMintUrls: ['https://mint.example'] }),
}));
jest.mock('@/shared/providers/OfflineProvider', () => ({
  useOfflineStatus: () => ({ isOffline: false }),
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: { getState: () => ({ activeUnit: mockActiveUnit }) },
}));
jest.mock('@/shared/stores/runtime/nearPayStore', () => ({
  useNearPaySessionStore: {
    getState: () => ({ start: jest.fn(), clear: jest.fn(), active: null }),
  },
}));
jest.mock('@/shared/stores/runtime/clearPaymentContext', () => ({
  clearPaymentContext: jest.fn(),
}));
jest.mock('@/shared/lib/nostr/useEntityCache', () => ({ readProfileRecord: () => null }));
jest.mock('@/shared/lib/logger', () => ({ paymentLog: { error: jest.fn() } }));
jest.mock('@/shared/lib/identity', () => ({ resolveIdentityName: () => 'Peer' }));
jest.mock('@/features/nearPay/lib/peerProfile', () => ({ peerDisplayName: () => 'Peer' }));
jest.mock('@/features/nearPay/lib/nearPaySendDecision', () => ({
  planNearPaySend: () => ({
    mode: 'send',
    recipientPubkey: 'ab'.repeat(32),
    lockPubkey: `02${'ab'.repeat(32)}`,
    allowedMints: ['https://mint.example'],
  }),
}));
jest.mock('@/features/nearPay/lib/startNearPaySend', () => ({
  notifyNoSharedMint: jest.fn(),
  notifyNutDropNeedsBitcoinAccount: () => mockNeedsBitcoinAccount(),
  notifyNutDropPeerNotReady: jest.fn(),
  notifyNearbyNeedsConnection: jest.fn(),
}));

import { renderHook } from '@testing-library/react-native';

import { useStartNearbySend } from '@/features/nearPay/hooks/useStartNearbySend';

type Peer = Parameters<ReturnType<typeof useStartNearbySend>>[0];
// Only the fields the mocked planner would read; the planner itself is mocked.
const peer = JSON.parse('{"peerID":"peer","nickname":"Peer"}') as Peer;

beforeEach(() => {
  mockBindings.length = 0;
  jest.clearAllMocks();
});

it('binds the machine without a unit of its own', () => {
  renderHook(() => useStartNearbySend());

  expect(mockBindings).toHaveLength(1);
  expect(mockBindings[0]).not.toHaveProperty('unit');
});

it('starts a nearby send when the active unit is sat', async () => {
  mockActiveUnit = 'sat';
  const { result } = renderHook(() => useStartNearbySend());

  await result.current(peer);

  expect(mockStartSendEcash).toHaveBeenCalledTimes(1);
});

it('starts nothing in another unit, so there is no flow that needed the pin', async () => {
  mockActiveUnit = 'usd';
  const { result } = renderHook(() => useStartNearbySend());

  await result.current(peer);

  expect(mockStartSendEcash).not.toHaveBeenCalled();
  expect(mockNeedsBitcoinAccount).toHaveBeenCalledTimes(1);
});

it('goes by the unit the calling screen pinned, not the one the account shows', async () => {
  // Send opened for dollars while the account shows sat: the flow would run in dollars.
  mockActiveUnit = 'sat';
  const { result } = renderHook(() => useStartNearbySend('usd'));

  await result.current(peer);

  expect(mockStartSendEcash).not.toHaveBeenCalled();
  expect(mockNeedsBitcoinAccount).toHaveBeenCalledTimes(1);
  expect(mockBindings[0]).not.toHaveProperty('unit');
});
