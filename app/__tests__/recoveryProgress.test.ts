/**
 * @jest-environment node
 */

import {
  computeRecoveryCounts,
  countKnownFailures,
  createInitialMintStates,
  currentMint,
  currentMintPosition,
  describeMintProgress,
  isSuccess,
  isTerminal,
  mintStatusToCheckpoint,
  type MintRecoveryState,
} from '@/features/settings/lib/recoveryProgress';
import { mapCheckpointStatusToIndicator } from '@/shared/blocks/status/mapCheckpointStatus';

function state(overrides: Partial<MintRecoveryState> = {}): MintRecoveryState {
  return {
    mint: 'https://mint.example',
    isDiscovered: false,
    status: 'waiting',
    keysetsTotal: null,
    keysetsDone: 0,
    failedKeysets: 0,
    alreadyRecoveredKeysets: 0,
    skippedKeysets: 0,
    fundsFound: false,
    startedAtMs: null,
    durationMs: null,
    ...overrides,
  };
}

describe('createInitialMintStates', () => {
  it('marks only the probed URLs as discovered', () => {
    const states = createInitialMintStates(['https://a', 'https://b'], ['https://c']);

    expect(states.map((s) => s.mint)).toEqual(['https://a', 'https://b', 'https://c']);
    expect(states.map((s) => s.isDiscovered)).toEqual([false, false, true]);
    expect(states.every((s) => s.status === 'waiting')).toBe(true);
  });
});

describe('computeRecoveryCounts', () => {
  it('counts a failed mint as settled — the ring must not stall on it', () => {
    const counts = computeRecoveryCounts([
      state({ status: 'done' }),
      state({ status: 'failed' }),
      state({ status: 'restoring' }),
    ]);

    expect(counts).toMatchObject({ settled: 2, succeeded: 1, failed: 1, total: 3 });
    expect(counts.allSettled).toBe(false);
    expect(counts.progressPct).toBeCloseTo(2 / 3);
  });

  it('is allSettled only when every mint reached a terminal status', () => {
    expect(
      computeRecoveryCounts([state({ status: 'done' }), state({ status: 'failed' })]).allSettled
    ).toBe(true);
  });

  it('does not report an empty run as complete', () => {
    expect(computeRecoveryCounts([])).toMatchObject({
      settled: 0,
      total: 0,
      allSettled: false,
      progressPct: 0,
    });
  });

  it('clamps progress to 0..1', () => {
    const allFailed = computeRecoveryCounts([
      state({ status: 'failed' }),
      state({ status: 'failed' }),
    ]);
    expect(allFailed.progressPct).toBe(1);
    expect(allFailed.succeeded).toBe(0);
  });
});

describe('countKnownFailures', () => {
  it('ignores probed mints, which are expected to miss', () => {
    const states = [state({ status: 'failed', isDiscovered: true }), state({ status: 'done' })];
    expect(countKnownFailures(states)).toBe(0);
  });

  it('counts a failure on a mint the user actually has', () => {
    expect(countKnownFailures([state({ status: 'failed', isDiscovered: false })])).toBe(1);
  });
});

describe('describeMintProgress', () => {
  it('shows the keyset denominator once it is known', () => {
    const s = state({ status: 'restoring', keysetsTotal: 8, keysetsDone: 3, startedAtMs: 1_000 });
    expect(describeMintProgress(s, 2_000)).toBe('3 of 8 keysets');
  });

  it('says it is reading keysets before the denominator arrives', () => {
    expect(describeMintProgress(state({ status: 'restoring' }), 0)).toBe('Reading keysets');
  });

  it('flags a long-running mint so a slow scan is not read as a hang', () => {
    const s = state({ status: 'restoring', keysetsTotal: 3, keysetsDone: 1, startedAtMs: 0 });
    expect(describeMintProgress(s, 25_000)).toBe('1 of 3 keysets · still scanning');
  });

  it('surfaces the failure reason instead of a count', () => {
    const s = state({ status: 'failed', error: '2 keyset(s) failed' });
    expect(describeMintProgress(s, 0)).toBe('2 keyset(s) failed');
  });

  it('falls back to the balance line when the mint is done', () => {
    expect(describeMintProgress(state({ status: 'done' }), 0)).toBeNull();
  });
});

describe('isTerminal', () => {
  it.each([
    ['done', true],
    ['already-recovered', true],
    ['skipped', true],
    ['failed', true],
    ['restoring', false],
    ['waiting', false],
  ] as const)('%s -> %s', (status, expected) => {
    expect(isTerminal(status)).toBe(expected);
  });
});

describe('isSuccess', () => {
  it('counts an already-recovered mint as a success', () => {
    // A second recovery run finds every proof already stored. That is the
    // expected outcome, not a failure — reporting it as one is what made the
    // screen claim three mints had failed when nothing was wrong.
    expect(isSuccess('already-recovered')).toBe(true);
    expect(isSuccess('done')).toBe(true);
  });

  it('does not count skipped or failed as success', () => {
    expect(isSuccess('skipped')).toBe(false);
    expect(isSuccess('failed')).toBe(false);
  });
});

describe('currentMint', () => {
  it('names the one mint in flight — only meaningful now mints run serially', () => {
    const states = [
      state({ mint: 'https://a', status: 'done' }),
      state({ mint: 'https://b', status: 'restoring' }),
      state({ mint: 'https://c', status: 'waiting' }),
    ];
    expect(currentMint(states)?.mint).toBe('https://b');
    expect(currentMintPosition(states)).toBe(2);
  });

  it('has no current mint between mints, and reports settled instead', () => {
    const states = [state({ status: 'done' }), state({ status: 'done' })];
    expect(currentMint(states)).toBeNull();
    expect(currentMintPosition(states)).toBe(2);
  });
});

describe('mintStatusToCheckpoint', () => {
  it('leaves a queued mint genuinely idle rather than spinning', () => {
    // `future` resolves to phase 'idle' — a dimmed, dashed, STATIONARY ring.
    // A mint that has not started is doing nothing, and animating it is the
    // same lie the old single-spinner screen told.
    expect(mapCheckpointStatusToIndicator(mintStatusToCheckpoint('waiting'))).toEqual({
      phase: 'idle',
      result: 'success',
    });
  });

  it('spins only the mint actually in flight', () => {
    expect(mapCheckpointStatusToIndicator(mintStatusToCheckpoint('restoring'))).toEqual({
      phase: 'loading',
      result: 'success',
    });
  });

  it('shows already-recovered as a plain success, not a problem', () => {
    expect(mapCheckpointStatusToIndicator(mintStatusToCheckpoint('already-recovered'))).toEqual({
      phase: 'done',
      result: 'success',
    });
  });

  it.each([
    ['done', { phase: 'done', result: 'success' }],
    ['failed', { phase: 'done', result: 'error' }],
    ['skipped', { phase: 'done', result: 'reverted' }],
  ] as const)('%s renders as %o', (status, expected) => {
    expect(mapCheckpointStatusToIndicator(mintStatusToCheckpoint(status))).toEqual(expected);
  });
});

describe('describeMintProgress for the new statuses', () => {
  it('says a mint was already recovered rather than showing an error', () => {
    expect(describeMintProgress(state({ status: 'already-recovered' }), 0)).toBe(
      'Already recovered'
    );
  });

  it('reports a skip reason when one was given', () => {
    expect(describeMintProgress(state({ status: 'skipped', error: 'Cancelled' }), 0)).toBe(
      'Cancelled'
    );
  });
});
