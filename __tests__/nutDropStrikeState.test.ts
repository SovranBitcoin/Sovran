import {
  deriveStrikeMap,
  STRIKE_FADE_LINGER_MS,
  STRIKE_MAX_ACTIVE_MS,
  STRIKE_MIN_VISIBLE_MS,
  STRIKE_SUCCESS_LINGER_MS,
  STRIKE_WAITING_LINGER_MS,
  type DeriveStrikeMapInput,
  type StrikeQueueEntry,
  type StrikeState,
} from '@/features/nearPay/lib/nutDropStrikeState';

const PEER = 'aaaa111122223333';
const T0 = 1_000_000;

function entry(
  status: StrikeQueueEntry['status'],
  senderPeerID: string | null = PEER,
  amount = 21,
  overrides: Partial<StrikeQueueEntry> = {}
): StrikeQueueEntry {
  return {
    status,
    senderPeerID: senderPeerID ?? undefined,
    receivedAt: T0,
    amount,
    unit: 'sat',
    ...overrides,
  };
}

function retryWaitingEntry(overrides: Partial<StrikeQueueEntry> = {}): StrikeQueueEntry {
  return entry('pending', PEER, 21, {
    attempts: 1,
    nextAttemptAt: T0 + 30_000,
    ...overrides,
  });
}

function strikeState(overrides: Partial<StrikeState> = {}): StrikeState {
  return {
    status: 'active',
    activatedAt: T0,
    entrance: 'strike',
    statusChangedAt: T0,
    ...overrides,
  };
}

function derive(overrides: Partial<DeriveStrikeMapInput>) {
  return deriveStrikeMap({
    entries: {},
    prev: new Map<string, StrikeState>(),
    baselineTerminalHashes: new Set(),
    baselineLiveHashes: new Set(),
    now: T0,
    ...overrides,
  });
}

describe('deriveStrikeMap', () => {
  it('activates on a live entry with a strike entrance', () => {
    const { map, nextDeadline } = derive({ entries: { h1: entry('pending') } });
    expect(map.get(PEER)).toMatchObject({ status: 'active', entrance: 'strike' });
    expect(nextDeadline).toBe(T0 + STRIKE_MAX_ACTIVE_MS);
  });

  it('uses the ambient entrance when the entry was live at the first snapshot', () => {
    const { map } = derive({
      entries: { h1: entry('redeeming') },
      baselineLiveHashes: new Set(['h1']),
    });
    expect(map.get(PEER)).toMatchObject({ status: 'active', entrance: 'ambient' });
  });

  it('never animates entries that were terminal at mount', () => {
    const { map } = derive({
      entries: { h1: entry('redeemed') },
      baselineTerminalHashes: new Set(['h1']),
    });
    expect(map.size).toBe(0);
  });

  it('ignores entries without a sender attribution', () => {
    const { map } = derive({ entries: { h1: entry('pending', null) } });
    expect(map.size).toBe(0);
  });

  it('holds active until the minimum beat, then resolves to success', () => {
    const prev = new Map([[PEER, strikeState()]]);
    // Redeemed almost instantly — still active until MIN elapses.
    const early = derive({ entries: { h1: entry('redeemed') }, prev, now: T0 + 200 });
    expect(early.map.get(PEER)?.status).toBe('active');
    expect(early.nextDeadline).toBe(T0 + STRIKE_MIN_VISIBLE_MS);

    const after = derive({
      entries: { h1: entry('redeemed') },
      prev,
      now: T0 + STRIKE_MIN_VISIBLE_MS,
    });
    expect(after.map.get(PEER)?.status).toBe('success');
    expect(after.nextDeadline).toBe(T0 + STRIKE_MIN_VISIBLE_MS + STRIKE_SUCCESS_LINGER_MS);
  });

  it('holds active until the minimum beat, then resolves to waiting', () => {
    const prev = new Map([[PEER, strikeState()]]);
    const early = derive({
      entries: { h1: retryWaitingEntry() },
      prev,
      now: T0 + 200,
    });
    expect(early.map.get(PEER)?.status).toBe('active');
    expect(early.nextDeadline).toBe(T0 + STRIKE_MIN_VISIBLE_MS);

    const after = derive({
      entries: { h1: retryWaitingEntry() },
      prev,
      now: T0 + STRIKE_MIN_VISIBLE_MS,
    });
    expect(after.map.get(PEER)?.status).toBe('waiting');
    expect(after.nextDeadline).toBe(T0 + STRIKE_MIN_VISIBLE_MS + STRIKE_WAITING_LINGER_MS);
  });

  it('sums the redeemed amounts onto the success state for the celebration', () => {
    const prev = new Map([[PEER, strikeState()]]);
    const { map } = derive({
      entries: {
        h1: entry('redeemed', PEER, 21),
        h2: entry('redeemed', PEER, 34),
      },
      prev,
      now: T0 + STRIKE_MIN_VISIBLE_MS,
    });
    expect(map.get(PEER)).toMatchObject({
      status: 'success',
      redeemedAmount: 55,
      unit: 'sat',
    });
  });

  it('does not count baseline-terminal entries into the celebration amount', () => {
    const prev = new Map([[PEER, strikeState()]]);
    const { map } = derive({
      entries: {
        stale: entry('redeemed', PEER, 1000),
        h1: entry('redeemed', PEER, 21),
      },
      prev,
      baselineTerminalHashes: new Set(['stale']),
      now: T0 + STRIKE_MIN_VISIBLE_MS,
    });
    expect(map.get(PEER)).toMatchObject({ status: 'success', redeemedAmount: 21 });
  });

  it('reports per-cycle deltas across two drops from the same sender', () => {
    // Redeemed entries persist in the queue store for 24h. The hook retires
    // each success state's redeemedHashes into the terminal baseline, so a
    // SECOND drop from the same sender must announce only its own amount —
    // never the session total (the bug class: "Received 150" for a 50 drop).
    const baseline = new Set<string>();

    // Cycle 1: 100-sat drop succeeds.
    const first = derive({
      entries: { h1: entry('redeemed', PEER, 100) },
      prev: new Map([[PEER, strikeState()]]),
      baselineTerminalHashes: baseline,
      now: T0 + STRIKE_MIN_VISIBLE_MS,
    });
    const firstSuccess = first.map.get(PEER);
    expect(firstSuccess).toMatchObject({ status: 'success', redeemedAmount: 100 });
    for (const hash of firstSuccess?.redeemedHashes ?? []) baseline.add(hash);

    // Cycle 2 (after the linger): a fresh 50-sat drop from the same sender.
    const T1 = T0 + 60_000;
    const second = derive({
      entries: {
        h1: entry('redeemed', PEER, 100),
        h2: { ...entry('redeemed', PEER, 50), receivedAt: T1 },
      },
      prev: new Map([[PEER, strikeState({ activatedAt: T1, statusChangedAt: T1 })]]),
      baselineTerminalHashes: baseline,
      now: T1 + STRIKE_MIN_VISIBLE_MS,
    });
    expect(second.map.get(PEER)).toMatchObject({
      status: 'success',
      redeemedAmount: 50,
      redeemedHashes: ['h2'],
    });
  });

  it('leaves redeemedAmount off non-success states', () => {
    const { map } = derive({ entries: { h1: entry('pending') } });
    expect(map.get(PEER)?.redeemedAmount).toBeUndefined();
  });

  it('does not animate a retry-waiting entry that was never active', () => {
    const { map } = derive({ entries: { h1: retryWaitingEntry() } });
    expect(map.size).toBe(0);
  });

  it('removes the success state after its linger and never resurrects it', () => {
    const success = new Map([
      [PEER, strikeState({ status: 'success', statusChangedAt: T0 + 2000 })],
    ]);
    const lingering = derive({
      entries: { h1: entry('redeemed') },
      prev: success,
      now: T0 + 2000 + STRIKE_SUCCESS_LINGER_MS - 1,
    });
    expect(lingering.map.get(PEER)?.status).toBe('success');

    const gone = derive({
      entries: { h1: entry('redeemed') },
      prev: success,
      now: T0 + 2000 + STRIKE_SUCCESS_LINGER_MS,
    });
    expect(gone.map.size).toBe(0);
  });

  it('coalesces multiple drops from the same peer without resetting activatedAt', () => {
    const prev = new Map([[PEER, strikeState()]]);
    const { map } = derive({
      entries: { h1: entry('redeemed'), h2: entry('pending') },
      prev,
      now: T0 + 500,
    });
    expect(map.get(PEER)).toMatchObject({ status: 'active', activatedAt: T0 });
  });

  it('fades quietly on terminal failure', () => {
    const prev = new Map([[PEER, strikeState()]]);
    const { map, nextDeadline } = derive({
      entries: { h1: entry('untrusted-mint') },
      prev,
      now: T0 + 700,
    });
    expect(map.get(PEER)?.status).toBe('fading');
    expect(nextDeadline).toBe(T0 + 700 + STRIKE_FADE_LINGER_MS);
  });

  it('does not animate an instant failure that was never active', () => {
    const { map } = derive({ entries: { h1: entry('failed') } });
    expect(map.size).toBe(0);
  });

  it('caps a backoff-stuck active strike at the max duration', () => {
    const prev = new Map([[PEER, strikeState()]]);
    const { map } = derive({
      entries: { h1: entry('pending') },
      prev,
      now: T0 + STRIKE_MAX_ACTIVE_MS,
    });
    expect(map.get(PEER)?.status).toBe('fading');
  });

  it('redeemed entries that were never tracked live do not animate', () => {
    const { map } = derive({ entries: { h1: entry('redeemed') } });
    expect(map.size).toBe(0);
  });

  it('tracks two peers independently', () => {
    const OTHER = 'bbbb111122223333';
    const { map } = derive({
      entries: { h1: entry('pending'), h2: entry('pending', OTHER) },
    });
    expect(map.get(PEER)?.status).toBe('active');
    expect(map.get(OTHER)?.status).toBe('active');
  });
});
