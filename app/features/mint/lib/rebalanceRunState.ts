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
  // Sent and not yet seen to arrive: finished as far as the run goes, not completed.
  let settling = 0;
  let executing = false;

  for (const step of steps) {
    const status = stepStates[step.id]?.status;
    if (status === 'done') completed++;
    else if (status === 'settling' || status === 'paymentPending') settling++;
    else if (status === 'failed') failed++;
    else if (status === 'skipped') skipped++;
    else if (status && EXECUTING_STATUSES.has(status)) executing = true;
  }

  const terminal = completed + failed + skipped + settling;
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
