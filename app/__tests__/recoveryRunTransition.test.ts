/**
 * @jest-environment node
 *
 * The moves of a recovery run's value: a stop is asked for only while it
 * runs and carries through its later steps, and a mint's outcome is final.
 */
import { recoveryTransition, type RecoveryRun } from '@/features/settings/lib/recoveryRun';
import type { MintRecoveryState } from '@/features/settings/lib/recoveryProgress';

jest.mock('@/shared/lib/cashu/manager', () => ({ CocoManager: {} }));
jest.mock('@/shared/lib/cashu/managerInternals', () => ({}));
jest.mock('@/shared/lib/logger', () => ({
  cashuLog: { info: jest.fn(), warn: jest.fn() },
  mintUrlLogFields: () => ({}),
  redactError: (e: unknown) => e,
}));

const mint = { mint: 'https://a.example', isDiscovered: false };
const waiting: MintRecoveryState = { ...mint, status: 'waiting' };
const timedOut: MintRecoveryState = { ...mint, status: 'timed-out', fundsFound: false };
const done: MintRecoveryState = { ...mint, status: 'done', fundsFound: true, durationMs: 5 };

const restoring = (rows: MintRecoveryState[]): RecoveryRun => ({
  phase: 'running',
  step: 'restoring',
  rows,
  label: null,
});

it('asks a running run to stop, and says so', () => {
  expect(recoveryTransition(restoring([waiting]), { type: 'cancelRequested' })).toEqual({
    phase: 'cancelling',
    step: 'restoring',
    rows: [waiting],
    label: 'Stopping after this mint',
  });
});

it.each<RecoveryRun>([
  { phase: 'idle' },
  { phase: 'finished', rows: [done], end: { kind: 'complete' } },
])('ignores a stop when nothing runs (%o)', (run) => {
  expect(recoveryTransition(run, { type: 'cancelRequested' })).toBe(run);
});

it('keeps a stop asked for during the search through the restore step', () => {
  const searching: RecoveryRun = {
    phase: 'cancelling',
    step: 'discovering',
    rows: [],
    label: 'Stopping after this mint',
  };
  expect(
    recoveryTransition(searching, { type: 'stepStarted', step: 'restoring', rows: [waiting] })
  ).toEqual({ phase: 'cancelling', step: 'restoring', rows: [waiting], label: null });
});

it('never changes a mint that has its outcome, during the run or after it', () => {
  const during = restoring([done]);
  expect(recoveryTransition(during, { type: 'mintUpdated', index: 0, state: timedOut })).toBe(
    during
  );
  // A late result that found nothing leaves a timed-out mint as it was.
  const empty: MintRecoveryState = { ...mint, status: 'done', fundsFound: false, durationMs: 5 };
  const late = restoring([timedOut]);
  expect(recoveryTransition(late, { type: 'mintUpdated', index: 0, state: empty })).toBe(late);
  const after: RecoveryRun = { phase: 'finished', rows: [timedOut], end: { kind: 'incomplete' } };
  expect(recoveryTransition(after, { type: 'mintUpdated', index: 0, state: empty })).toBe(after);
});

it('records the funds a timed-out mint’s late restore found, and keeps it timed out', () => {
  const withFunds: MintRecoveryState = { ...timedOut, fundsFound: true };
  const during = restoring([timedOut]);
  expect(recoveryTransition(during, { type: 'mintUpdated', index: 0, state: done })).toEqual(
    restoring([withFunds])
  );
  const after: RecoveryRun = { phase: 'finished', rows: [timedOut], end: { kind: 'incomplete' } };
  expect(recoveryTransition(after, { type: 'mintUpdated', index: 0, state: done })).toEqual({
    ...after,
    rows: [withFunds],
  });
});

it('ends with the rows it has, or none when it never got to a step', () => {
  expect(
    recoveryTransition(restoring([done]), { type: 'ended', end: { kind: 'complete' } })
  ).toEqual({ phase: 'finished', rows: [done], end: { kind: 'complete' } });
  expect(
    recoveryTransition({ phase: 'idle' }, { type: 'ended', end: { kind: 'error', message: 'x' } })
  ).toEqual({ phase: 'finished', rows: [], end: { kind: 'error', message: 'x' } });
});
