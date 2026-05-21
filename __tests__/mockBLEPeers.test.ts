import {
  buildMockBLEPeers,
  getNextMockBLEPeerLoopState,
  INITIAL_MOCK_BLE_PEER_LOOP_STATE,
  MOCK_BLE_PEER_LOOP_INTERVAL_MS,
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
  it('uses a fast loop interval for stress-testing peer churn', () => {
    expect(MOCK_BLE_PEER_LOOP_INTERVAL_MS).toBe(600);
  });

  it('loops peer counts from one to max and back down to one', () => {
    const ascending = Array.from({ length: MOCK_BLE_PEER_MAX_COUNT }, (_, index) => index + 1);
    const descending = Array.from(
      { length: MOCK_BLE_PEER_MAX_COUNT - 1 },
      (_, index) => MOCK_BLE_PEER_MAX_COUNT - 1 - index
    );

    expect(countsForSteps(MOCK_BLE_PEER_MAX_COUNT * 2 - 1)).toEqual([...ascending, ...descending]);
  });

  it('continues upward after returning to one', () => {
    expect(countsForSteps(MOCK_BLE_PEER_MAX_COUNT * 2 + 1).slice(-3)).toEqual([1, 2, 3]);
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
