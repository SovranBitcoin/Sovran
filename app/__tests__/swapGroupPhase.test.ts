/**
 * @jest-environment node
 *
 * A saved swap group's phase is its saved state plus whether a run in this
 * process holds it: `running` with no holder reads as interrupted.
 */
import { holdSwapGroup, swapGroupOutcome, swapGroupPhase } from '@/shared/lib/cashu/swapGroupPhase';
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

describe('a failed attempt that a later successful attempt replaced does not fail the group', () => {
  const A = 'https://a.example';
  const B = 'https://b.example';
  const C = 'https://c.example';
  const D = 'https://d.example';
  const direct = (localStatus: SwapLeg['localStatus'], id = 'direct'): SwapLeg => ({
    id,
    fromMintUrl: A,
    toMintUrl: C,
    amount: 800,
    localStatus,
  });
  /** One hop of a chain over `path`, as the engine saves it. */
  const hop = (
    chainId: string,
    path: string[],
    index: number,
    localStatus: SwapLeg['localStatus'],
    amount = 790
  ): SwapLeg => ({
    id: `${chainId}-${index}`,
    fromMintUrl: path[index],
    toMintUrl: path[index + 1],
    amount,
    chainId,
    chainPath: path,
    chainHopIndex: index,
    localStatus,
  });
  const outcome = (legs: SwapLeg[], state: SwapGroup['state'] = 'finished') =>
    swapGroupOutcome({ id: 'g-replaced', state, legs });

  it('a direct leg that failed, then a route through another mint that arrived, is finished', () => {
    expect(
      outcome([
        direct('failed'),
        hop('ch1', [A, B, C], 0, 'done'),
        hop('ch1', [A, B, C], 1, 'done'),
      ])
    ).toBe('finished');
  });

  it('a route that failed, then another route for the same transfer that arrived, is finished', () => {
    expect(
      outcome([
        direct('failed'),
        hop('ch1', [A, B, C], 0, 'failed'),
        hop('ch2', [A, D, C], 0, 'done'),
        hop('ch2', [A, D, C], 1, 'done'),
      ])
    ).toBe('finished');
  });

  it('a cancelled run whose transfer arrived by another route reads cancelled, not failed', () => {
    expect(
      outcome(
        [direct('failed'), hop('ch1', [A, B, C], 0, 'done'), hop('ch1', [A, B, C], 1, 'done')],
        'cancelled'
      )
    ).toBe('cancelled');
  });

  it('a route whose last hop did not arrive replaces nothing', () => {
    expect(
      outcome([
        direct('failed'),
        hop('ch1', [A, B, C], 0, 'done'),
        hop('ch1', [A, B, C], 1, 'failed'),
      ])
    ).toBe('failed');
    expect(outcome([direct('failed'), hop('ch1', [A, B, C], 0, 'done')])).toBe('failed');
  });

  it('a route to another destination, or one that arrived before the failure, replaces nothing', () => {
    expect(
      outcome([
        direct('failed'),
        hop('ch1', [A, B, D], 0, 'done'),
        hop('ch1', [A, B, D], 1, 'done'),
      ])
    ).toBe('failed');
    expect(
      outcome([
        hop('ch1', [A, B, C], 0, 'done'),
        hop('ch1', [A, B, C], 1, 'done'),
        direct('failed'),
      ])
    ).toBe('failed');
  });

  it('a route that delivered far less than the failed attempt had to carry replaces nothing', () => {
    // The reviewer's case: 800 fails, and a route of 10 between the same mints arrives.
    expect(
      outcome([
        direct('failed'),
        hop('ch1', [A, B, C], 0, 'done', 10),
        hop('ch1', [A, B, C], 1, 'done', 10),
      ])
    ).toBe('failed');
    // It set out with the amount, but what reached the destination was far short of it.
    expect(
      outcome([
        direct('failed'),
        hop('ch1', [A, B, C], 0, 'done', 800),
        hop('ch1', [A, B, C], 1, 'done', 10),
      ])
    ).toBe('failed');
  });

  it('a route whose first hop is not in the saved legs cannot be tied to the attempt it replaced', () => {
    expect(outcome([direct('failed'), hop('ch1', [A, B, C], 1, 'done', 800)])).toBe('failed');
  });

  it('a route that delivered the amount less the fees of its hops replaces the failed attempt', () => {
    expect(
      outcome([
        direct('failed'),
        hop('ch1', [A, B, C], 0, 'done', 784),
        hop('ch1', [A, B, C], 1, 'done', 768),
      ])
    ).toBe('finished');
  });

  it('a direct transfer that arrived does not replace another direct transfer that failed', () => {
    expect(outcome([direct('failed', 'first'), direct('done', 'second')])).toBe('failed');
  });
});
