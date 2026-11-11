/**
 * @jest-environment node
 */

import {
  computeRecoveryCounts,
  fundsFound,
  mintRecoveryError,
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

type Where = { mint?: string; isDiscovered?: boolean };
const at = (where: Where) => ({ mint: 'https://mint.example', isDiscovered: false, ...where });
const waiting = (where: Where = {}): MintRecoveryState => ({ ...at(where), status: 'waiting' });
const restoring = (
  where: Where = {},
  progress: { keysetsTotal?: number | null; keysetsDone?: number; startedAtMs?: number } = {}
): MintRecoveryState => ({
  ...at(where),
  status: 'restoring',
  startedAtMs: 0,
  keysetsTotal: null,
  keysetsDone: 0,
  ...progress,
});
const done = (where: Where = {}): MintRecoveryState => ({
  ...at(where),
  status: 'done',
  fundsFound: false,
  durationMs: 1,
});
const alreadyRecovered = (where: Where = {}): MintRecoveryState => ({
  ...at(where),
  status: 'already-recovered',
  fundsFound: false,
  durationMs: 1,
});
const failed = (where: Where = {}, error = 'mint offline'): MintRecoveryState => ({
  ...at(where),
  status: 'failed',
  error,
  fundsFound: false,
  durationMs: null,
});
const timedOut = (where: Where = {}): MintRecoveryState => ({
  ...at(where),
  status: 'timed-out',
  fundsFound: false,
});
const cancelled = (where: Where = {}): MintRecoveryState => ({
  ...at(where),
  status: 'skipped',
  reason: 'cancelled',
  fundsFound: false,
});
const notRestorable = (where: Where = {}, funds = false): MintRecoveryState => ({
  ...at(where),
  status: 'skipped',
  reason: 'not-restorable',
  fundsFound: funds,
  durationMs: 1,
});

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
    const counts = computeRecoveryCounts([done(), failed(), restoring()]);

    expect(counts).toMatchObject({ settled: 2, succeeded: 1, failed: 1, total: 3 });
    expect(counts.allSettled).toBe(false);
    expect(counts.progressPct).toBeCloseTo(2 / 3);
  });

  it('is allSettled only when every mint reached a terminal status', () => {
    expect(computeRecoveryCounts([done(), failed()]).allSettled).toBe(true);
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
    const allFailed = computeRecoveryCounts([failed(), failed()]);
    expect(allFailed.progressPct).toBe(1);
    expect(allFailed.succeeded).toBe(0);
  });
});

describe('countKnownFailures', () => {
  it('ignores probed mints, which are expected to miss', () => {
    const states = [failed({ isDiscovered: true }), done()];
    expect(countKnownFailures(states)).toBe(0);
  });

  it('counts a failure on a mint the user actually has', () => {
    expect(countKnownFailures([failed({ isDiscovered: false })])).toBe(1);
  });
});

describe('describeMintProgress', () => {
  it('shows the keyset denominator once it is known', () => {
    const s = restoring({}, { keysetsTotal: 8, keysetsDone: 3, startedAtMs: 1_000 });
    expect(describeMintProgress(s, 2_000)).toBe('3 of 8 keysets');
  });

  it('says it is reading keysets before the denominator arrives', () => {
    expect(describeMintProgress(restoring(), 0)).toBe('Reading keysets');
  });

  it('flags a long-running mint so a slow scan is not read as a hang', () => {
    const s = restoring({}, { keysetsTotal: 3, keysetsDone: 1, startedAtMs: 0 });
    expect(describeMintProgress(s, 25_000)).toBe('1 of 3 keysets · still scanning');
  });

  it('surfaces the failure reason instead of a count', () => {
    const s = failed({}, '2 keyset(s) failed');
    expect(describeMintProgress(s, 0)).toBe('2 keyset(s) failed');
  });

  it('falls back to the balance line when the mint is done', () => {
    expect(describeMintProgress(done(), 0)).toBeNull();
  });
});

describe('isTerminal', () => {
  it.each([
    ['done', true],
    ['already-recovered', true],
    ['skipped', true],
    ['failed', true],
    ['timed-out', true],
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
      done({ mint: 'https://a' }),
      restoring({ mint: 'https://b' }),
      waiting({ mint: 'https://c' }),
    ];
    expect(currentMint(states)?.mint).toBe('https://b');
    expect(currentMintPosition(states)).toBe(2);
  });

  it('has no current mint between mints, and reports settled instead', () => {
    const states = [done(), done()];
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
    ['timed-out', { phase: 'done', result: 'error' }],
    ['skipped', { phase: 'done', result: 'reverted' }],
  ] as const)('%s renders as %o', (status, expected) => {
    expect(mapCheckpointStatusToIndicator(mintStatusToCheckpoint(status))).toEqual(expected);
  });
});

describe('describeMintProgress for the new statuses', () => {
  it('says a mint was already recovered rather than showing an error', () => {
    expect(describeMintProgress(alreadyRecovered(), 0)).toBe('Already recovered');
  });

  it('reports a skip reason when one was given', () => {
    expect(describeMintProgress(cancelled(), 0)).toBe('Cancelled');
  });
});

describe('a mint that timed out', () => {
  it('counts as a failure, on a known mint, and says it timed out', () => {
    expect(computeRecoveryCounts([timedOut(), done()])).toMatchObject({ settled: 2, failed: 1 });
    expect(countKnownFailures([timedOut()])).toBe(1);
    expect(describeMintProgress(timedOut(), 0)).toBe('Timed out');
  });
});

describe("a row's error line and found funds", () => {
  it.each([
    ['failed', failed({}, 'mint offline'), 'mint offline'],
    ['timed out', timedOut(), 'Timed out'],
    ['cancelled', cancelled(), 'Cancelled'],
    ['not restorable', notRestorable(), undefined],
    ['done', done(), undefined],
    ['waiting', waiting(), undefined],
  ])('%s', (_name, row, error) => {
    expect(mintRecoveryError(row)).toBe(error);
  });

  it('finds funds only where a restore read the balance', () => {
    const funded: MintRecoveryState = {
      ...at({}),
      status: 'done',
      fundsFound: true,
      durationMs: 1,
    };
    expect(fundsFound(funded)).toBe(true);
    expect(fundsFound(notRestorable({}, true))).toBe(true);
    expect(fundsFound(timedOut())).toBe(false);
    expect(fundsFound(cancelled())).toBe(false);
  });
});
