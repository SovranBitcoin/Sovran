import { toSafeSatAmount } from '@/shared/lib/cashu/amount';
import { cashuLog } from '@/shared/lib/logger';
import type { TransferStep } from '@/features/mint/components/rebalance';
import type { StepState } from '@/features/mint/components/rebalance/groupSteps';

interface RebalanceStepCounts {
  completed: number;
  failed: number;
  skipped: number;
  executing: boolean;
  allComplete: boolean;
  progressPct: number;
  hasFailedStep: boolean;
}

interface MiddlemanRouteSuggestion {
  path?: string[] | null;
  pathNames?: string[] | null;
}

interface MiddlemanCandidateRoute {
  path: string[];
  pathNames: string[];
  source: 'graph' | 'local_history';
}

type TransferAmountDecision =
  | {
      status: 'skip';
      minRequired: number;
    }
  | {
      status: 'ready';
      amount: number;
      capped: false;
    }
  | {
      status: 'capped';
      amount: number;
      capped: true;
    };

export const PENDING_STEP_STATE: StepState = Object.freeze({ status: 'pending' });

const EXECUTING_STATUSES = new Set<StepState['status']>([
  'creatingInvoice',
  'invoiceReady',
  'melting',
  'verifying',
  'routing',
]);

export function createInitialStepStates(steps: readonly TransferStep[]): Record<string, StepState> {
  const states = Object.fromEntries(steps.map((step) => [step.id, { status: 'pending' as const }]));
  cashuLog.debug('mint.rebalance.run_state.initial_steps', {
    stepCount: steps.length,
  });
  return states;
}

export function mergeStepState(
  states: Record<string, StepState>,
  stepId: string,
  update: Partial<StepState>
): Record<string, StepState> {
  const next = {
    ...states,
    [stepId]: { ...states[stepId], ...update },
  };
  cashuLog.debug('mint.rebalance.run_state.merge_step', {
    stepId,
    previousStatus: states[stepId]?.status ?? null,
    nextStatus: next[stepId]?.status ?? null,
    updateKeys: Object.keys(update).sort(),
  });
  return next;
}

export function computeRebalanceStepCounts(
  steps: readonly TransferStep[],
  stepStates: Record<string, StepState>,
  hasRunPlan: boolean
): RebalanceStepCounts {
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let executing = false;

  for (const step of steps) {
    const status = stepStates[step.id]?.status;
    if (status === 'done') completed++;
    else if (status === 'failed') failed++;
    else if (status === 'skipped') skipped++;
    else if (status && EXECUTING_STATUSES.has(status)) executing = true;
  }

  const terminal = completed + failed + skipped;
  const counts = {
    completed,
    failed,
    skipped,
    executing,
    allComplete: hasRunPlan ? terminal === steps.length : false,
    progressPct:
      !hasRunPlan || steps.length === 0 ? 0 : Math.max(0, Math.min(1, terminal / steps.length)),
    hasFailedStep: failed > 0,
  };
  cashuLog.debug('mint.rebalance.run_state.step_counts', {
    stepCount: steps.length,
    hasRunPlan,
    ...counts,
  });
  return counts;
}

export function countRunnableSteps(
  steps: readonly TransferStep[],
  stepStates: Record<string, StepState>
): number {
  const count = steps.filter((step) => {
    const status = stepStates[step.id]?.status;
    return status !== 'done' && status !== 'skipped';
  }).length;
  cashuLog.debug('mint.rebalance.run_state.runnable_steps', {
    stepCount: steps.length,
    runnableCount: count,
  });
  return count;
}

export function resetFailedStepStates(
  states: Record<string, StepState>,
  steps: readonly TransferStep[]
): Record<string, StepState> {
  const next = { ...states };
  for (const step of steps) {
    if (next[step.id]?.status === 'failed') {
      next[step.id] = {
        ...next[step.id],
        status: 'pending',
        errorMessage: undefined,
        routeSuggestion: undefined,
      };
    }
  }
  cashuLog.debug('mint.rebalance.run_state.reset_failed', {
    stepCount: steps.length,
    failedBeforeCount: steps.filter((step) => states[step.id]?.status === 'failed').length,
  });
  return next;
}

export function insertStepsAfter(
  steps: readonly TransferStep[],
  afterId: string,
  toInsert: readonly TransferStep[]
): TransferStep[] {
  const index = steps.findIndex((step) => step.id === afterId);
  if (index === -1) {
    cashuLog.warn('mint.rebalance.run_state.insert_steps.missing_after', {
      afterId,
      originalCount: steps.length,
      insertCount: toInsert.length,
    });
    return [...steps];
  }
  const next = [...steps.slice(0, index + 1), ...toInsert, ...steps.slice(index + 1)];
  cashuLog.info('mint.rebalance.run_state.insert_steps.result', {
    afterId,
    originalCount: steps.length,
    insertCount: toInsert.length,
    nextCount: next.length,
  });
  return next;
}

export function createChainSteps({
  baseStep,
  chainPath,
  chainId,
  idPrefix,
  makeId,
}: {
  baseStep: TransferStep;
  chainPath: readonly string[];
  chainId: string;
  idPrefix: string;
  makeId: (label: string) => string;
}): TransferStep[] {
  const steps: TransferStep[] = [];
  for (let index = 0; index < chainPath.length - 1; index++) {
    steps.push({
      ...baseStep,
      id: makeId(`${idPrefix}-${index}`),
      fromMintUrl: chainPath[index],
      toMintUrl: chainPath[index + 1],
      chainId,
      chainPath: [...chainPath],
      chainHopIndex: index,
    });
  }
  cashuLog.info('mint.rebalance.run_state.chain_steps.result', {
    chainId,
    pathLength: chainPath.length,
    stepCount: steps.length,
    idPrefix,
  });
  return steps;
}

export function applyInsertedChainStates(
  states: Record<string, StepState>,
  skippedOriginalStepId: string,
  insertedSteps: readonly TransferStep[],
  originalUpdate: Partial<StepState> = {}
): Record<string, StepState> {
  const next = {
    ...states,
    [skippedOriginalStepId]: {
      ...states[skippedOriginalStepId],
      status: 'skipped' as const,
      ...originalUpdate,
    },
  };

  for (const step of insertedSteps) {
    next[step.id] = { status: 'pending' };
  }

  cashuLog.info('mint.rebalance.run_state.inserted_chain_states.result', {
    skippedOriginalStepId,
    insertedStepCount: insertedSteps.length,
    nextStateCount: Object.keys(next).length,
    originalUpdateKeys: Object.keys(originalUpdate).sort(),
  });
  return next;
}

export function createMiddlemanCandidateRoutes({
  fromMintUrl,
  toMintUrl,
  suggestion,
  localFallbackMintUrls,
  getMintName,
}: {
  fromMintUrl: string;
  toMintUrl: string;
  suggestion: MiddlemanRouteSuggestion | null | undefined;
  localFallbackMintUrls: readonly string[];
  getMintName: (mintUrl: string) => string;
}): MiddlemanCandidateRoute[] {
  const routes: MiddlemanCandidateRoute[] = [];

  if (suggestion?.path && suggestion.path.length >= 3) {
    routes.push({
      path: suggestion.path,
      pathNames: suggestion.pathNames ?? suggestion.path.map(getMintName),
      source: 'graph',
    });
  }

  for (const candidateUrl of localFallbackMintUrls) {
    const alreadyCoveredByGraph = routes.some(
      (route) => route.source === 'graph' && route.path.includes(candidateUrl)
    );
    if (alreadyCoveredByGraph) continue;

    routes.push({
      path: [fromMintUrl, candidateUrl, toMintUrl],
      pathNames: [getMintName(fromMintUrl), getMintName(candidateUrl), getMintName(toMintUrl)],
      source: 'local_history',
    });
  }

  cashuLog.info('mint.rebalance.run_state.middleman_routes.result', {
    hasGraphSuggestion: !!suggestion?.path && suggestion.path.length >= 3,
    graphPathLength: suggestion?.path?.length ?? null,
    localFallbackCount: localFallbackMintUrls.length,
    routeCount: routes.length,
    routeSources: routes.map((route) => route.source),
    fromEqualsTo: fromMintUrl === toMintUrl,
  });
  return routes;
}

export function formatCandidateRoutingDetail({
  routeIndex,
  routeCount,
  pathNames,
}: {
  routeIndex: number;
  routeCount: number;
  pathNames: readonly string[];
}): string {
  const intermediaryNames = pathNames.slice(1, -1).join(' → ');
  cashuLog.debug('mint.rebalance.run_state.route_detail', {
    routeIndex,
    routeCount,
    pathNameCount: pathNames.length,
    intermediaryCount: Math.max(0, pathNames.length - 2),
  });
  if (routeCount > 1) {
    return `Trying route ${routeIndex + 1}/${routeCount}: via ${intermediaryNames}…`;
  }
  return `Routing via ${intermediaryNames}…`;
}

export function computeInitialTransferAmount({
  requestedAmount,
  sourceBalance,
  minTransferThreshold,
  feeHeadroom,
}: {
  requestedAmount: number;
  sourceBalance: number;
  minTransferThreshold: number;
  feeHeadroom: number;
}): TransferAmountDecision {
  const minRequired = minTransferThreshold + feeHeadroom;
  const requestedSatAmount = toSafeSatAmount(requestedAmount) ?? 0;
  if (sourceBalance < minRequired || requestedSatAmount < minTransferThreshold) {
    cashuLog.info('mint.rebalance.run_state.initial_transfer_amount', {
      status: 'skip',
      requestedAmount,
      requestedSatAmount,
      sourceBalance,
      minTransferThreshold,
      feeHeadroom,
      minRequired,
    });
    return { status: 'skip', minRequired };
  }

  if (requestedSatAmount + feeHeadroom > sourceBalance) {
    const amount = toSafeSatAmount(sourceBalance - feeHeadroom) ?? 0;
    cashuLog.info('mint.rebalance.run_state.initial_transfer_amount', {
      status: 'capped',
      requestedAmount,
      requestedSatAmount,
      sourceBalance,
      minTransferThreshold,
      feeHeadroom,
      minRequired,
      amount,
    });
    return {
      status: 'capped',
      amount,
      capped: true,
    };
  }

  cashuLog.info('mint.rebalance.run_state.initial_transfer_amount', {
    status: 'ready',
    requestedAmount,
    requestedSatAmount,
    sourceBalance,
    minTransferThreshold,
    feeHeadroom,
    minRequired,
    amount: requestedSatAmount,
  });
  return {
    status: 'ready',
    amount: requestedSatAmount,
    capped: false,
  };
}
