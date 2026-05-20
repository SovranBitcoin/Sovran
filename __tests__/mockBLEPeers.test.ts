import {
  buildMockBLEPeers,
  getNextMockBLEPeerLoopState,
  INITIAL_MOCK_BLE_PEER_LOOP_STATE,
  MOCK_BLE_PEER_MAX_COUNT,
  MOCK_BLE_PEER_MIN_COUNT,
  type MockBLEPeerLoopState,
} from '@/features/bitchat/lib/mockBLEPeers';

function countsForSteps(steps: number): number[] {
  let state: MockBLEPeerLoopState = INITIAL_MOCK_BLE_PEER_LOOP_STATE;
  const counts = [state.count];

  for (let index = 1; index < steps; index++) {
    state = getNextMockBLEPeerLoopState(state);
    counts.push(state.count);
  }

  return counts;
}

describe('mock BLE peers', () => {
  it('loops peer counts from one to ten and back down to one', () => {
    expect(countsForSteps(19)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('continues upward after returning to one', () => {
    expect(countsForSteps(21).slice(-3)).toEqual([1, 2, 3]);
  });

  it('builds stable direct-link peers and clamps count to the supported range', () => {
    const tooMany = buildMockBLEPeers(99, 1_000);
    const tooFew = buildMockBLEPeers(0, 1_000);

    expect(tooMany).toHaveLength(MOCK_BLE_PEER_MAX_COUNT);
    expect(tooFew).toHaveLength(MOCK_BLE_PEER_MIN_COUNT);
    expect(tooMany[0]).toMatchObject({
      peerID: 'mock-near-pay-peer-1',
      nickname: 'Ada',
      isConnected: true,
      hasDirectLink: true,
      lastSeen: 1_000,
    });
    expect(tooMany[1]?.lastSeen).toBe(0);
  });
});
