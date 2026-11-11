/**
 * @jest-environment node
 *
 * A saved swap group's phase is its saved state plus whether a run in this
 * process holds it: `running` with no holder reads as interrupted.
 */
import { holdSwapGroup, swapGroupPhase } from '@/shared/lib/cashu/swapGroupPhase';

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
