import {
  applyInsertedChainStates,
  computeInitialTransferAmount,
  computeRebalanceStepCounts,
  createChainSteps,
  createInitialStepStates,
  createMiddlemanCandidateRoutes,
  formatCandidateRoutingDetail,
  insertStepsAfter,
  normalizeRebalanceTransferError,
  resetFailedStepStates,
} from '@/features/mint/lib/rebalanceRunState';
import type { TransferStep } from '@/features/mint/components/rebalance';
import type { StepState } from '@/features/mint/components/rebalance/groupSteps';

const step = (id: string, fromMintUrl = `${id}-from`, toMintUrl = `${id}-to`): TransferStep => ({
  id,
  fromMintUrl,
  toMintUrl,
  amount: 21,
});

describe('rebalanceRunState', () => {
  it('creates pending state for every plan step', () => {
    expect(createInitialStepStates([step('a'), step('b')])).toEqual({
      a: { status: 'pending' },
      b: { status: 'pending' },
    });
  });

  it('computes terminal counts and progress only for a frozen run plan', () => {
    const steps = [step('done'), step('failed'), step('skipped'), step('busy')];
    const states: Record<string, StepState> = {
      done: { status: 'done' },
      failed: { status: 'failed' },
      skipped: { status: 'skipped' },
      busy: { status: 'melting' },
    };

    expect(computeRebalanceStepCounts(steps, states, true)).toMatchObject({
      completed: 1,
      failed: 1,
      skipped: 1,
      executing: true,
      allComplete: false,
      progressPct: 0.75,
      hasFailedStep: true,
    });

    expect(computeRebalanceStepCounts(steps, states, false).progressPct).toBe(0);
  });

  it('resets only failed steps for retry runs', () => {
    const states: Record<string, StepState> = {
      a: { status: 'failed', errorMessage: 'no route', routeSuggestion: { status: 'none' } },
      b: { status: 'done' },
    };

    expect(resetFailedStepStates(states, [step('a'), step('b')])).toEqual({
      a: { status: 'pending', errorMessage: undefined, routeSuggestion: undefined },
      b: { status: 'done' },
    });
  });

  it('creates one chain step per hop with stable chain metadata', () => {
    const chainSteps = createChainSteps({
      baseStep: step('original', 'mint-a', 'mint-c'),
      chainPath: ['mint-a', 'mint-b', 'mint-c'],
      chainId: 'chain-1',
      idPrefix: 'reroute-original',
      makeId: (label) => `id:${label}`,
    });

    expect(chainSteps).toEqual([
      {
        id: 'id:reroute-original-0',
        fromMintUrl: 'mint-a',
        toMintUrl: 'mint-b',
        amount: 21,
        chainId: 'chain-1',
        chainPath: ['mint-a', 'mint-b', 'mint-c'],
        chainHopIndex: 0,
      },
      {
        id: 'id:reroute-original-1',
        fromMintUrl: 'mint-b',
        toMintUrl: 'mint-c',
        amount: 21,
        chainId: 'chain-1',
        chainPath: ['mint-a', 'mint-b', 'mint-c'],
        chainHopIndex: 1,
      },
    ]);
  });

  it('inserts chain steps after the original and marks the original skipped', () => {
    const inserted = [step('hop-1'), step('hop-2')];

    expect(insertStepsAfter([step('a'), step('b')], 'a', inserted).map((s) => s.id)).toEqual([
      'a',
      'hop-1',
      'hop-2',
      'b',
    ]);

    expect(applyInsertedChainStates({ a: { status: 'failed' } }, 'a', inserted)).toEqual({
      a: { status: 'skipped' },
      'hop-1': { status: 'pending' },
      'hop-2': { status: 'pending' },
    });
  });

  it('builds graph and local-history middleman candidates without duplicate graph hops', () => {
    const routes = createMiddlemanCandidateRoutes({
      fromMintUrl: 'mint-a',
      toMintUrl: 'mint-d',
      suggestion: {
        path: ['mint-a', 'mint-b', 'mint-d'],
        pathNames: ['Mint A', 'Mint B', 'Mint D'],
      },
      localFallbackMintUrls: ['mint-b', 'mint-c'],
      getMintName: (url) => `name:${url}`,
    });

    expect(routes).toEqual([
      {
        path: ['mint-a', 'mint-b', 'mint-d'],
        pathNames: ['Mint A', 'Mint B', 'Mint D'],
        source: 'graph',
      },
      {
        path: ['mint-a', 'mint-c', 'mint-d'],
        pathNames: ['name:mint-a', 'name:mint-c', 'name:mint-d'],
        source: 'local_history',
      },
    ]);
  });

  it('formats candidate routing detail for single and fallback route attempts', () => {
    expect(
      formatCandidateRoutingDetail({
        routeIndex: 0,
        routeCount: 1,
        pathNames: ['Mint A', 'Mint B', 'Mint C'],
      })
    ).toBe('Routing via Mint B…');

    expect(
      formatCandidateRoutingDetail({
        routeIndex: 1,
        routeCount: 3,
        pathNames: ['Mint A', 'Mint B', 'Mint C'],
      })
    ).toBe('Trying route 2/3: via Mint B…');
  });

  it('decides whether an initial transfer should run, cap, or skip by fee headroom', () => {
    expect(
      computeInitialTransferAmount({
        requestedAmount: 100,
        sourceBalance: 150,
        minTransferThreshold: 10,
        feeHeadroom: 5,
      })
    ).toEqual({ status: 'ready', amount: 100, capped: false });

    expect(
      computeInitialTransferAmount({
        requestedAmount: 100,
        sourceBalance: 102,
        minTransferThreshold: 10,
        feeHeadroom: 5,
      })
    ).toEqual({ status: 'capped', amount: 97, capped: true });

    expect(
      computeInitialTransferAmount({
        requestedAmount: 100,
        sourceBalance: 14,
        minTransferThreshold: 10,
        feeHeadroom: 5,
      })
    ).toEqual({ status: 'skip', minRequired: 15 });
  });

  it('normalizes common mint and Lightning errors for the row UI', () => {
    expect(normalizeRebalanceTransferError(new Error('lnd is not ready for payments'))).toMatch(
      /Mint Lightning node is not ready/
    );
    expect(normalizeRebalanceTransferError(new Error('FAILURE_REASON_NO_ROUTE'))).toBe(
      'No Lightning route found. No middleman route available either.'
    );
    expect(normalizeRebalanceTransferError(new Error('invoice expired'))).toBe(
      'Invoice expired before payment could complete. Please retry.'
    );
    expect(normalizeRebalanceTransferError(new Error('custom failure'))).toBe('custom failure');
  });
});
