/**
 * The Balance split plan's cards (`groupStepsForDisplay`): which plan steps
 * share a chain card, in what order, and which skipped steps are hidden.
 */
import {
  groupStepsForDisplay,
  type StepState,
} from '@/features/mint/components/rebalance/groupSteps';
import type { TransferStep } from '@/features/mint/components/rebalance/rebalancePlanner';

const step = (id: string, over: Partial<TransferStep> = {}): TransferStep => ({
  id,
  fromMintUrl: `${id}-from`,
  toMintUrl: `${id}-to`,
  amount: 21,
  ...over,
});
const hop = (id: string, chainId: string) =>
  step(id, { chainId, chainPath: [`${chainId}-a`, 'b', 'c'] });

const shape = (steps: TransferStep[], states: Record<string, StepState> = {}) =>
  groupStepsForDisplay(steps, states).map((g) => [
    g.id,
    g.chainId,
    g.chainPath,
    g.steps.map((s) => s.id),
  ]);

describe('groupStepsForDisplay', () => {
  it('puts consecutive steps of one chain in one card, and each standalone step in its own, in plan order', () => {
    expect(shape([step('s1'), hop('h1', 'ch'), hop('h2', 'ch'), step('s2')])).toEqual([
      ['s1', null, undefined, ['s1']],
      ['chain-ch', 'ch', ['ch-a', 'b', 'c'], ['h1', 'h2']],
      ['s2', null, undefined, ['s2']],
    ]);
  });

  it('splits a chain whose steps are not adjacent into two cards with the same id', () => {
    expect(shape([hop('h1', 'ch'), step('s1'), hop('h2', 'ch')])).toEqual([
      ['chain-ch', 'ch', ['ch-a', 'b', 'c'], ['h1']],
      ['s1', null, undefined, ['s1']],
      ['chain-ch', 'ch', ['ch-a', 'b', 'c'], ['h2']],
    ]);
  });

  it('hides a skipped standalone step before grouping, so the chain around it stays one card', () => {
    const states: Record<string, StepState> = {
      direct: { status: 'skipped' },
      h2: { status: 'skipped' },
    };
    expect(shape([hop('h1', 'ch'), step('direct'), hop('h2', 'ch')], states)).toEqual([
      ['chain-ch', 'ch', ['ch-a', 'b', 'c'], ['h1', 'h2']],
    ]);
  });
});
