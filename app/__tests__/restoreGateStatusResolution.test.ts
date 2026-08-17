/**
 * @jest-environment node
 *
 * Which `restoreStatus` values pin the app to the recovery gate.
 *
 * A build briefly had the recovery screen write 'in-progress' when a run
 * started. AppGate blocked on that value and nothing in the Settings-initiated
 * path ever cleared it, so the app booted straight into the recovery gate on
 * every launch — with a wallet that was perfectly healthy. These cases pin the
 * contract so that cannot come back silently.
 */

type RestoreStatus = 'unknown' | 'not-needed' | 'pending' | 'in-progress' | 'complete' | 'failed';

/** Mirrors AppGate's blocking condition. */
function blocksApp(status: RestoreStatus): boolean {
  return status === 'pending' || status === 'failed';
}

/** Mirrors AppGate's "already decided, skip re-evaluation" early return. */
function skipsReevaluation(status: RestoreStatus): boolean {
  return status === 'complete' || status === 'not-needed' || status === 'pending';
}

describe('restore gate status resolution', () => {
  it.each([
    ['pending', true],
    ['failed', true],
    ['complete', false],
    ['not-needed', false],
    ['unknown', false],
    // The regression: a stranded 'in-progress' must NOT hold the gate open.
    ['in-progress', false],
  ] as const)('%s blocks the app: %s', (status, expected) => {
    expect(blocksApp(status)).toBe(expected);
  });

  it('re-evaluates a stranded in-progress instead of trusting it', () => {
    // Falling through to re-evaluation is what heals installs stuck by the old
    // build: the gate then decides from seedCreatedAt, sending anyone whose
    // seed this install created to 'not-needed'.
    expect(skipsReevaluation('in-progress')).toBe(false);
    expect(skipsReevaluation('unknown')).toBe(false);
    expect(skipsReevaluation('failed')).toBe(false);
  });

  it('still trusts a decision already made in a previous boot', () => {
    expect(skipsReevaluation('pending')).toBe(true);
    expect(skipsReevaluation('complete')).toBe(true);
    expect(skipsReevaluation('not-needed')).toBe(true);
  });
});
