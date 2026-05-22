import {
  buildMockBLEPeers,
  getMockBLEPeerProfile,
  getNextMockBLEPeerLoopState,
  INITIAL_MOCK_BLE_PEER_LOOP_STATE,
  MOCK_BLE_PEER_LOOP_INTERVAL_MS,
  MOCK_BLE_PEER_MAX_COUNT,
  MOCK_BLE_PEER_MIN_COUNT,
  MOCK_BLE_PEER_PROFILES,
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

  it('keeps the stress count backed by real named profile fixtures', () => {
    expect(MOCK_BLE_PEER_MAX_COUNT).toBe(24);
    expect(MOCK_BLE_PEER_PROFILES).toHaveLength(MOCK_BLE_PEER_MAX_COUNT);
    expect(new Set(MOCK_BLE_PEER_PROFILES.map((profile) => profile.peerID)).size).toBe(
      MOCK_BLE_PEER_MAX_COUNT
    );
    expect(MOCK_BLE_PEER_PROFILES.every((profile) => profile.npub.startsWith('npub1'))).toBe(true);
    expect(MOCK_BLE_PEER_PROFILES.map((profile) => profile.nickname).slice(0, 4)).toEqual([
      'Calle',
      'thesimplekid',
      'a1denvalu3',
      'Rob Woodgate',
    ]);
    expect(MOCK_BLE_PEER_PROFILES[8]).toMatchObject({
      nickname: 'gladstein',
      npub: 'npub1trr5r2nrpsk6xkjk5a7p6pfcryyt6yzsflwjmz6r7uj7lfkjxxtq78hdpu',
      picture:
        'https://r2.primal.net/cache/e/24/41/e2441c12e15d1450824f097afc77375d8e5318360e8aa650e97e4ff62eeeb114.jpg',
    });
    expect(MOCK_BLE_PEER_PROFILES.map((profile) => profile.nickname).slice(20, 23)).toEqual([
      'Sovran',
      'KELBIE | sovran.money',
      'Minibits',
    ]);
    expect(MOCK_BLE_PEER_PROFILES[19]).toMatchObject({
      nickname: 'Adam Back',
      picture:
        'https://primaldata.s3.us-east-005.backblazeb2.com/cache/c/38/92/c38922a228813e5e8d972374d1d830e76c7df3f3b131e675071666037a6aeabd.jpg',
    });
    expect(MOCK_BLE_PEER_PROFILES[23]).toMatchObject({
      nickname: 'HODL',
      npub: 'npub1rtlqca8r6auyaw5n5h3l5422dm4sry5dzfee4696fqe8s6qgudks7djtfs',
      picture:
        'https://r2.primal.net/cache/0/c6/24/0c62490569b550c58450c392e2a972413d11320fa5696a7f79a16efa1d8ce83c.gif',
    });
    expect(
      [
        'Alex Gleason',
        'Vitor Pamplona',
        'Michael Saylor',
        'PABLOF7z',
        'Jack Mallers',
        'hodlbod',
        'Carman',
        'Jimmy Song',
      ].some((removedName) =>
        MOCK_BLE_PEER_PROFILES.some((profile) => profile.nickname === removedName)
      )
    ).toBe(false);
    expect(
      [
        'Will Casarin',
        'Marty Bent',
        'Naval',
        'Saifedean Ammous',
        'Anita Posch',
        'Bitcoin Q+A',
      ].some((removedName) =>
        MOCK_BLE_PEER_PROFILES.some((profile) => profile.nickname === removedName)
      )
    ).toBe(false);
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
      peerID: MOCK_BLE_PEER_PROFILES[0].peerID,
      nickname: 'Calle',
      isConnected: true,
      hasDirectLink: true,
      lastSeen: 1_000,
    });
    expect(tooMany[1]?.lastSeen).toBe(0);
    expect(tooMany.map((peer) => peer.peerID)).toEqual(
      MOCK_BLE_PEER_PROFILES.map((profile) => profile.peerID)
    );
    expect(tooMany.some((peer) => peer.peerID.startsWith('mock-near-pay-peer'))).toBe(false);
    expect(tooMany.some((peer) => /^near pay \d+$/i.test(peer.nickname))).toBe(false);
    expect(getMockBLEPeerProfile(tooMany[0].peerID)?.picture).toBe(
      'https://avatars.githubusercontent.com/u/93376500'
    );
    expect(getMockBLEPeerProfile(tooMany[20].peerID)?.picture).toBe(
      'https://blossom.primal.net/6bf922b8fa44d126270a1f5db09c1182bc8bafe62ed98790bd5ba4b08b728533.png'
    );
  });
});
