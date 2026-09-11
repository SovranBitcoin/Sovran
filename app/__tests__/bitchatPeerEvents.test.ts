import { act, renderHook } from '@testing-library/react-native';
import { useBitChat } from '@/features/bitchat/hooks/useBitChat';
import { bitchatLog } from '@/shared/lib/logger';
import type { BLEPeerEvent } from 'bitchat-module';

let mockPeerListener: (event: BLEPeerEvent) => void;
const mockRemove = jest.fn();
const mockIdentity = { nostrPubkey: 'a'.repeat(64) };
jest.mock('bitchat-module', () => ({
  startBLE: jest.fn().mockResolvedValue(undefined),
  getBLEState: () => 'poweredOn',
  addBLEStateListener: () => ({ remove: mockRemove }),
  addBLEMessageListener: () => ({ remove: mockRemove }),
  addBLEPeerListener: (listener: typeof mockPeerListener) => {
    mockPeerListener = listener;
    return { remove: mockRemove };
  },
}));
jest.mock('@/features/bitchat/hooks/useBitchatNickname', () => ({
  useBitchatNickname: () => 'Tester',
}));
jest.mock('@/features/bitchat/hooks/useBitchatBLEIdentityMaterial', () => ({
  useBitchatBLEIdentityMaterial: () => mockIdentity,
}));
jest.mock('@/features/bitchat/lib/profileScope', () => ({
  useBitchatProfileScope: () => 'profile',
}));
jest.mock('@/features/bitchat/stores/bitchatDmMessages', () => ({
  useBitchatDmMessagesStore: jest.fn(),
}));
jest.mock('@/shared/lib/logger', () => ({
  bitchatLog: { info: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));
jest.mock('@/shared/lib/id', () => ({ mintLocalId: jest.fn() }));
jest.mock('@/shared/lib/protocolIds', () => ({ asNostrPubkeyHex: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

test('BLE chat handles native iOS and Android peer list events without requiring a peerID', async () => {
  const view = renderHook(() => useBitChat(undefined, 'ble'));
  await act(async () => {});
  // Exact payload emitted by both native bridges' didUpdatePeerList callback.
  expect(() => {
    act(() => mockPeerListener({ type: 'list', peers: ['0123456789abcdef'] }));
    act(() => mockPeerListener({ type: 'list', peers: [] }));
  }).not.toThrow();
  expect(bitchatLog.debug).toHaveBeenLastCalledWith('bitchat.hook.ble_peer', {
    type: 'list',
    peerCount: 0,
  });
  view.unmount();
  expect(mockRemove).toHaveBeenCalledTimes(3);
});

test.each(['connected', 'disconnected'] as const)(
  'BLE chat logs an iOS %s peer event without exposing the full identifier',
  async (type) => {
    const view = renderHook(() => useBitChat(undefined, 'ble'));
    await act(async () => {});
    act(() => mockPeerListener({ type, peerID: '0123456789abcdef' }));
    expect(bitchatLog.debug).toHaveBeenLastCalledWith('bitchat.hook.ble_peer', {
      type,
      peerIdPrefix: '0123',
      isConnected: type === 'connected',
    });
    view.unmount();
  }
);
