import type { BLEPeer } from 'bitchat-module';

export const MOCK_BLE_PEER_MIN_COUNT = 1;
export const MOCK_BLE_PEER_MAX_COUNT = 10;
export const MOCK_BLE_PEER_LOOP_INTERVAL_MS = 1_200;

export interface MockBLEPeerLoopState {
  count: number;
  direction: 1 | -1;
}

const MOCK_BLE_PEER_NAMES = ['Ada', 'Ben', 'Cy', 'Dee', 'Eli', 'Flo', 'Gia', 'Hal', 'Ivy', 'Jae'];

export const INITIAL_MOCK_BLE_PEER_LOOP_STATE: MockBLEPeerLoopState = {
  count: MOCK_BLE_PEER_MIN_COUNT,
  direction: 1,
};

export function getNextMockBLEPeerLoopState(state: MockBLEPeerLoopState): MockBLEPeerLoopState {
  if (state.direction === 1 && state.count >= MOCK_BLE_PEER_MAX_COUNT) {
    return { count: MOCK_BLE_PEER_MAX_COUNT - 1, direction: -1 };
  }
  if (state.direction === -1 && state.count <= MOCK_BLE_PEER_MIN_COUNT) {
    return { count: MOCK_BLE_PEER_MIN_COUNT + 1, direction: 1 };
  }
  return {
    count: state.count + state.direction,
    direction: state.direction,
  };
}

export function buildMockBLEPeers(count: number, now = Date.now()): BLEPeer[] {
  const peerCount = Math.max(
    MOCK_BLE_PEER_MIN_COUNT,
    Math.min(MOCK_BLE_PEER_MAX_COUNT, Math.round(count))
  );

  return Array.from({ length: peerCount }, (_, index) => ({
    peerID: `mock-near-pay-peer-${index + 1}`,
    nickname: MOCK_BLE_PEER_NAMES[index] ?? `Peer ${index + 1}`,
    isConnected: true,
    hasDirectLink: true,
    lastSeen: now - index * 1_000,
  }));
}
