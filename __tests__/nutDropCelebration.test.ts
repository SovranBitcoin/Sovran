import {
  CELEBRATION_COOLDOWN_MS,
  CELEBRATION_FRESHNESS_MS,
  CELEBRATION_QUEUE_CAP,
  celebrationReducer,
  INITIAL_CELEBRATION_STATE,
  type CelebrationEvent,
  type CelebrationState,
} from '@/features/nearPay/lib/nutDropCelebration';

const T0 = 1_000_000;
const ALICE = 'aaaa111122223333';
const BOB = 'bbbb111122223333';
const CAROL = 'cccc111122223333';

function success(peerID: string, amount = 21, now = T0): CelebrationEvent {
  return { type: 'strike-success', peerID, amount, unit: 'sat', now };
}

function run(events: CelebrationEvent[], from = INITIAL_CELEBRATION_STATE): CelebrationState {
  return events.reduce(celebrationReducer, from);
}

describe('celebrationReducer', () => {
  it('starts a full-length ceremony from idle when ungated', () => {
    const state = run([success(ALICE)]);
    expect(state.phase).toBe('centering');
    expect(state.current).toMatchObject({
      peerID: ALICE,
      amount: 21,
      unit: 'sat',
      abbreviated: false,
    });
    expect(state.lastStartedAt).toBe(T0);
  });

  it('advances centering → held → returning → idle on phase-complete', () => {
    let state = run([success(ALICE)]);
    state = celebrationReducer(state, { type: 'phase-complete', now: T0 + 300 });
    expect(state.phase).toBe('held');
    state = celebrationReducer(state, { type: 'phase-complete', now: T0 + 1100 });
    expect(state.phase).toBe('returning');
    state = celebrationReducer(state, { type: 'phase-complete', now: T0 + 1500 });
    expect(state.phase).toBe('idle');
    expect(state.current).toBeNull();
  });

  it('coalesces a same-sender drop into the playing ceremony amount', () => {
    const state = run([success(ALICE, 21), success(ALICE, 34, T0 + 100)]);
    expect(state.phase).toBe('centering');
    expect(state.current).toMatchObject({ amount: 55 });
    expect(state.queue).toHaveLength(0);
  });

  it('queues a different sender and plays them abbreviated afterwards', () => {
    let state = run([success(ALICE), success(BOB, 8, T0 + 200)]);
    expect(state.queue).toMatchObject([{ peerID: BOB, amount: 8 }]);

    state = run(
      [
        { type: 'phase-complete', now: T0 + 300 },
        { type: 'phase-complete', now: T0 + 1100 },
        { type: 'phase-complete', now: T0 + 1500 },
      ],
      state
    );
    expect(state.phase).toBe('centering');
    expect(state.current).toMatchObject({ peerID: BOB, amount: 8, abbreviated: true });
  });

  it('coalesces same-sender requests inside the queue', () => {
    const state = run([success(ALICE), success(BOB, 8, T0 + 100), success(BOB, 5, T0 + 200)]);
    expect(state.queue).toMatchObject([{ peerID: BOB, amount: 13, firedAt: T0 + 200 }]);
  });

  it('caps the queue and drops overflow silently', () => {
    const state = run([
      success(ALICE),
      success(BOB, 8, T0 + 100),
      success(CAROL, 5, T0 + 200),
      success('dddd111122223333', 3, T0 + 300),
    ]);
    expect(state.queue).toHaveLength(CELEBRATION_QUEUE_CAP);
    expect(state.queue.map((request) => request.peerID)).toEqual([BOB, CAROL]);
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
    expect(state.current).toMatchObject({ peerID: BOB, abbreviated: true });
    expect(state.queue).toHaveLength(0);
  });

  it('stays idle when the gate lifts and every deferred request went stale', () => {
    let state = run([{ type: 'gate-changed', gated: true, now: T0 }, success(ALICE, 21, T0 + 100)]);
    state = celebrationReducer(state, {
      type: 'gate-changed',
      gated: false,
      now: T0 + 100 + CELEBRATION_FRESHNESS_MS + 1,
    });
    expect(state.phase).toBe('idle');
    expect(state.queue).toHaveLength(0);
  });

  it('fast-forwards a playing ceremony to returning when the gate closes', () => {
    const state = run([success(ALICE), { type: 'gate-changed', gated: true, now: T0 + 100 }]);
    expect(state.phase).toBe('returning');
    expect(state.gated).toBe(true);
  });

  it('skip jumps to the return flight and is a no-op while idle', () => {
    const playing = run([success(ALICE)]);
    expect(celebrationReducer(playing, { type: 'skip', now: T0 + 100 }).phase).toBe('returning');
    expect(celebrationReducer(INITIAL_CELEBRATION_STATE, { type: 'skip', now: T0 })).toBe(
      INITIAL_CELEBRATION_STATE
    );
  });

  it('abbreviates a fresh start inside the cooldown window', () => {
    let state = run([
      success(ALICE),
      { type: 'phase-complete', now: T0 + 300 },
      { type: 'phase-complete', now: T0 + 1100 },
      { type: 'phase-complete', now: T0 + 1500 },
    ]);
    state = celebrationReducer(state, success(BOB, 8, T0 + 2000));
    expect(state.current).toMatchObject({ peerID: BOB, abbreviated: true });

    // Past the cooldown the full ceremony returns.
    let later = run([
      success(ALICE),
      { type: 'phase-complete', now: T0 + 300 },
      { type: 'phase-complete', now: T0 + 1100 },
      { type: 'phase-complete', now: T0 + 1500 },
    ]);
    later = celebrationReducer(later, success(BOB, 8, T0 + CELEBRATION_COOLDOWN_MS + 1));
    expect(later.current).toMatchObject({ peerID: BOB, abbreviated: false });
  });

  it('a same-sender drop during the return flight queues a fresh ceremony', () => {
    let state = run([
      success(ALICE),
      { type: 'phase-complete', now: T0 + 300 },
      { type: 'phase-complete', now: T0 + 1100 },
    ]);
    expect(state.phase).toBe('returning');
    state = celebrationReducer(state, success(ALICE, 5, T0 + 1200));
    expect(state.queue).toMatchObject([{ peerID: ALICE, amount: 5 }]);
    state = celebrationReducer(state, { type: 'phase-complete', now: T0 + 1500 });
    expect(state.phase).toBe('centering');
    expect(state.current).toMatchObject({ peerID: ALICE, amount: 5, abbreviated: true });
  });

  it('reset returns to the initial state', () => {
    const state = run([success(ALICE), { type: 'reset' }]);
    expect(state).toBe(INITIAL_CELEBRATION_STATE);
  });
});
