import {
  CELEBRATION_COOLDOWN_MS,
  CELEBRATION_FRESHNESS_MS,
  CELEBRATION_QUEUE_CAP,
  celebrationReducer,
  INITIAL_CELEBRATION_STATE,
  type CelebrationEvent,
  type CelebrationPhase,
  type CelebrationState,
} from '@/features/nearPay/lib/nutDropCelebration';

const T0 = 1_000_000;
const ALICE = 'aaaa111122223333';
const BOB = 'bbbb111122223333';
const CAROL = 'cccc111122223333';

function active(peerID: string, now = T0): CelebrationEvent {
  return { type: 'strike-active', peerID, unit: 'sat', now };
}

function success(peerID: string, amount = 21, now = T0): CelebrationEvent {
  return { type: 'strike-success', peerID, amount, unit: 'sat', now };
}

function failed(peerID: string, now = T0): CelebrationEvent {
  return { type: 'strike-failed', peerID, now };
}

function complete(phase: CelebrationPhase, now: number): CelebrationEvent {
  return { type: 'phase-complete', phase, now };
}

/** Drop arrives → confirms mid-flight → full beat sequence back to idle. */
function fullCycle(peerID = ALICE, startNow = T0): CelebrationEvent[] {
  return [
    active(peerID, startNow),
    success(peerID, 21, startNow + 100),
    complete('centering', startNow + 300),
    complete('held', startNow + 1100),
    complete('returning', startNow + 1500),
  ];
}

function run(events: CelebrationEvent[], from = INITIAL_CELEBRATION_STATE): CelebrationState {
  return events.reduce(celebrationReducer, from);
}

describe('celebrationReducer', () => {
  it('starts the takeover when a fresh drop arrives, amount unknown', () => {
    const state = run([active(ALICE)]);
    expect(state.phase).toBe('centering');
    expect(state.current).toMatchObject({
      peerID: ALICE,
      amount: null,
      unit: 'sat',
      abbreviated: false,
    });
    expect(state.lastStartedAt).toBe(T0);
    expect(state.ceremonyId).toBe(1);
  });

  it('parks at center (awaiting) when arrival precedes confirmation', () => {
    let state = run([active(ALICE), complete('centering', T0 + 300)]);
    expect(state.phase).toBe('awaiting');
    // Confirmation while parked fires the impact immediately.
    state = celebrationReducer(state, success(ALICE, 21, T0 + 900));
    expect(state.phase).toBe('held');
    expect(state.current).toMatchObject({ amount: 21 });
  });

  it('fires the impact on arrival when confirmation lands mid-flight', () => {
    let state = run([active(ALICE), success(ALICE, 21, T0 + 100)]);
    expect(state.phase).toBe('centering');
    expect(state.current).toMatchObject({ amount: 21 });
    state = celebrationReducer(state, complete('centering', T0 + 300));
    expect(state.phase).toBe('held');
  });

  it('starts a ceremony from a bare success (ambient entries)', () => {
    let state = run([success(ALICE, 21)]);
    expect(state.phase).toBe('centering');
    expect(state.current).toMatchObject({ peerID: ALICE, amount: 21 });
    state = celebrationReducer(state, complete('centering', T0 + 300));
    expect(state.phase).toBe('held');
  });

  it('exits quietly (no impact) when the redeem fails mid-ceremony', () => {
    const fromAwaiting = run([active(ALICE), complete('centering', T0 + 300)]);
    expect(celebrationReducer(fromAwaiting, failed(ALICE, T0 + 900)).phase).toBe('returning');

    const fromCentering = run([active(ALICE)]);
    expect(celebrationReducer(fromCentering, failed(ALICE, T0 + 100)).phase).toBe('returning');
  });

  it('times out the awaiting act instead of holding center forever', () => {
    let state = run([active(ALICE), complete('centering', T0 + 300)]);
    state = celebrationReducer(state, complete('awaiting', T0 + 10_300));
    expect(state.phase).toBe('returning');
  });

  it('advances held → returning → idle on phase-complete', () => {
    let state = run([active(ALICE), success(ALICE, 21, T0 + 100), complete('centering', T0 + 300)]);
    expect(state.phase).toBe('held');
    state = celebrationReducer(state, complete('held', T0 + 1100));
    expect(state.phase).toBe('returning');
    state = celebrationReducer(state, complete('returning', T0 + 1500));
    expect(state.phase).toBe('idle');
    expect(state.current).toBeNull();
  });

  it('ignores a phase-complete whose scheduled phase lost a race', () => {
    // Timer armed for 'centering' fires just after a skip already moved the
    // ceremony to 'returning' — without the token it would cut the return
    // flight to zero and end the ceremony instantly.
    let state = run([active(ALICE), { type: 'skip', now: T0 + 100 }]);
    expect(state.phase).toBe('returning');
    const afterStale = celebrationReducer(state, complete('centering', T0 + 300));
    expect(afterStale).toBe(state);
    state = celebrationReducer(state, complete('returning', T0 + 400));
    expect(state.phase).toBe('idle');
  });

  it('a duplicate strike-active for the playing sender is a no-op', () => {
    const playing = run([active(ALICE)]);
    expect(celebrationReducer(playing, active(ALICE, T0 + 50))).toBe(playing);
  });

  it('folds a second same-sender confirmation into the held amount', () => {
    let state = run([active(ALICE), success(ALICE, 21, T0 + 100), complete('centering', T0 + 300)]);
    state = celebrationReducer(state, success(ALICE, 34, T0 + 500));
    expect(state.phase).toBe('held');
    expect(state.current).toMatchObject({ amount: 55 });
    expect(state.queue).toHaveLength(0);
  });

  it('queues a different sender and plays them abbreviated afterwards', () => {
    let state = run([active(ALICE), active(BOB, T0 + 200)]);
    expect(state.queue).toMatchObject([{ peerID: BOB, amount: null }]);

    // Bob's redeem confirms while queued — the queued request is enriched.
    state = celebrationReducer(state, success(BOB, 8, T0 + 400));
    expect(state.queue).toMatchObject([{ peerID: BOB, amount: 8 }]);

    state = run(
      [
        success(ALICE, 21, T0 + 500),
        complete('centering', T0 + 600),
        complete('held', T0 + 1400),
        complete('returning', T0 + 1800),
      ],
      state
    );
    expect(state.phase).toBe('centering');
    expect(state.current).toMatchObject({ peerID: BOB, amount: 8, abbreviated: true });
    expect(state.ceremonyId).toBe(2);
  });

  it('removes a queued sender whose redeem fails', () => {
    let state = run([active(ALICE), active(BOB, T0 + 200)]);
    state = celebrationReducer(state, failed(BOB, T0 + 400));
    expect(state.queue).toHaveLength(0);
    expect(state.phase).toBe('centering');
  });

  it('caps the queue and drops overflow silently', () => {
    const state = run([
      active(ALICE),
      active(BOB, T0 + 100),
      active(CAROL, T0 + 200),
      active('dddd111122223333', T0 + 300),
    ]);
    expect(state.queue).toHaveLength(CELEBRATION_QUEUE_CAP);
    expect(state.queue.map((request) => request.peerID)).toEqual([BOB, CAROL]);
  });

  it('evicts stale queue entries instead of letting them hold cap slots', () => {
    let state = run([
      { type: 'gate-changed', gated: true, now: T0 },
      active(ALICE, T0 + 100),
      active(BOB, T0 + 100),
      active(CAROL, T0 + 100),
    ]);
    expect(state.queue).toHaveLength(2);

    const lateNow = T0 + 100 + CELEBRATION_FRESHNESS_MS + 1;
    state = celebrationReducer(state, active('eeee111122223333', lateNow));
    expect(state.queue).toMatchObject([{ peerID: 'eeee111122223333' }]);
  });

  it('defers requests while gated and plays only fresh ones when the gate lifts', () => {
    let state = run([
      { type: 'gate-changed', gated: true, now: T0 },
      success(ALICE, 21, T0 + 100),
      success(BOB, 8, T0 + 200),
    ]);
    expect(state.phase).toBe('idle');
    expect(state.queue).toHaveLength(2);

    // Alice's request goes stale; Bob's stays inside the freshness window.
    const ungateAt = T0 + 100 + CELEBRATION_FRESHNESS_MS + 1;
    state = celebrationReducer(state, { type: 'gate-changed', gated: false, now: ungateAt });
    expect(state.phase).toBe('centering');
    expect(state.current).toMatchObject({ peerID: BOB, amount: 8, abbreviated: true });
    expect(state.queue).toHaveLength(0);
  });

  it('fast-forwards a playing ceremony to returning when the gate closes', () => {
    const centering = run([active(ALICE), { type: 'gate-changed', gated: true, now: T0 + 100 }]);
    expect(centering.phase).toBe('returning');

    const awaiting = run([
      active(ALICE),
      complete('centering', T0 + 300),
      { type: 'gate-changed', gated: true, now: T0 + 400 },
    ]);
    expect(awaiting.phase).toBe('returning');
  });

  it('bails identically (same reference) on no-op gate events', () => {
    expect(
      celebrationReducer(INITIAL_CELEBRATION_STATE, {
        type: 'gate-changed',
        gated: false,
        now: T0,
      })
    ).toBe(INITIAL_CELEBRATION_STATE);
  });

  it('skip jumps to the return flight from any playing act', () => {
    expect(celebrationReducer(run([active(ALICE)]), { type: 'skip', now: T0 + 100 }).phase).toBe(
      'returning'
    );
    const awaiting = run([active(ALICE), complete('centering', T0 + 300)]);
    expect(celebrationReducer(awaiting, { type: 'skip', now: T0 + 400 }).phase).toBe('returning');
    expect(celebrationReducer(INITIAL_CELEBRATION_STATE, { type: 'skip', now: T0 })).toBe(
      INITIAL_CELEBRATION_STATE
    );
  });

  it('abbreviates a fresh start inside the cooldown window', () => {
    let state = run(fullCycle());
    state = celebrationReducer(state, active(BOB, T0 + 2000));
    expect(state.current).toMatchObject({ peerID: BOB, abbreviated: true });

    // Past the cooldown the full ceremony returns.
    let later = run(fullCycle());
    later = celebrationReducer(later, active(BOB, T0 + CELEBRATION_COOLDOWN_MS + 1));
    expect(later.current).toMatchObject({ peerID: BOB, abbreviated: false });
  });

  it('a same-sender confirmation during the return flight queues a fresh ceremony', () => {
    let state = run([
      active(ALICE),
      success(ALICE, 21, T0 + 100),
      complete('centering', T0 + 300),
      complete('held', T0 + 1100),
    ]);
    expect(state.phase).toBe('returning');
    state = celebrationReducer(state, success(ALICE, 5, T0 + 1200));
    expect(state.queue).toMatchObject([{ peerID: ALICE, amount: 5 }]);
    state = celebrationReducer(state, complete('returning', T0 + 1500));
    expect(state.phase).toBe('centering');
    expect(state.current).toMatchObject({ peerID: ALICE, amount: 5, abbreviated: true });
  });

  it('assigns a fresh ceremonyId to every ceremony, including queue pops', () => {
    let state = run([active(ALICE), active(BOB, T0 + 100), success(BOB, 8, T0 + 150)]);
    expect(state.ceremonyId).toBe(1);
    state = run(
      [
        success(ALICE, 21, T0 + 200),
        complete('centering', T0 + 300),
        complete('held', T0 + 1100),
        complete('returning', T0 + 1500),
      ],
      state
    );
    expect(state.phase).toBe('centering');
    expect(state.current?.peerID).toBe(BOB);
    expect(state.ceremonyId).toBe(2);
  });

  it('reset returns to the initial state', () => {
    const state = run([active(ALICE), { type: 'reset' }]);
    expect(state).toBe(INITIAL_CELEBRATION_STATE);
  });
});
