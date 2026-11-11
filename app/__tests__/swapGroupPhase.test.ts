/**
 * @jest-environment node
 *
 * A saved swap group's phase is its saved state plus whether a run in this
 * process holds it: `running` with no holder reads as interrupted.
 */
import {
  holdSwapGroup,
  swapGroupOutcome,
  swapGroupPhase,
} from '@/shared/lib/cashu/swapGroupPhase';
import type { SwapGroup, SwapLeg } from '@/shared/stores/profile/swapTransactionsStore';

it('reads a running group as running only while a run holds it', () => {
  const group = { id: 'g-held', state: 'running' as const };
  expect(swapGroupPhase(group)).toBe('interrupted');

  const release = holdSwapGroup(group.id);
  expect(swapGroupPhase(group)).toBe('running');

  release();
  expect(swapGroupPhase(group)).toBe('interrupted');
});

it('keeps a group held until every hold is released, and a second release is harmless', () => {
  const group = { id: 'g-twice', state: 'running' as const };
  const first = holdSwapGroup(group.id);
  const second = holdSwapGroup(group.id);

  first();
  first();
  expect(swapGroupPhase(group)).toBe('running');

  second();
  expect(swapGroupPhase(group)).toBe('interrupted');
});

it.each(['finished', 'cancelled'] as const)(
  'reads a %s group as it was saved, held or not',
  (state) => {
    const release = holdSwapGroup('g-final');
    expect(swapGroupPhase({ id: 'g-final', state })).toBe(state);
    release();
    expect(swapGroupPhase({ id: 'g-final', state })).toBe(state);
  }
);

describe('what a saved group shows: money still moving first, then a failed leg, then how the run ended', () => {
  const leg = (localStatus: SwapLeg['localStatus'], id = `leg-${localStatus}`): SwapLeg => ({
    id,
    fromMintUrl: 'a',
    toMintUrl: 'b',
    amount: 10,
    localStatus,
  });
  const outcome = (state: SwapGroup['state'], legs: SwapLeg[]) =>
    swapGroupOutcome({ id: 'g-outcome', state, legs });

  it.each(['running', 'finished', 'cancelled'] as const)(
    'a %s group with a failed leg and a leg still settling is in progress',
    (state) => {
      expect(outcome(state, [leg('failed'), leg('settling')])).toBe('inProgress');
    }
  );

  it('a running group no run holds, with a failed leg, is in progress until it is reconciled', () => {
    expect(outcome('running', [leg('failed')])).toBe('inProgress');
  });

  it.each(['finished', 'cancelled'] as const)(
    'a %s group with a failed leg and nothing moving has failed',
    (state) => {
      expect(outcome(state, [leg('done'), leg('failed')])).toBe('failed');
    }
  );

  it.each(['finished', 'cancelled'] as const)(
    'a %s group with no failed leg and nothing moving reads as it was saved',
    (state) => {
      expect(outcome(state, [leg('done'), leg('pending')])).toBe(state);
    }
  );
});
