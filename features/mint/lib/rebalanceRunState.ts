import { toSafeSatAmount } from '@/shared/lib/cashu/amount';
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
  return Object.fromEntries(steps.map((step) => [step.id, { status: 'pending' as const }]));
}

export function mergeStepState(
  states: Record<string, StepState>,
  stepId: string,
  update: Partial<StepState>
): Record<string, StepState> {
  return {
    ...states,
    [stepId]: { ...states[stepId], ...update },
  };
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
  return {
    completed,
    failed,
    skipped,
    executing,
    allComplete: hasRunPlan ? terminal === steps.length : false,
    progressPct:
      !hasRunPlan || steps.length === 0 ? 0 : Math.max(0, Math.min(1, terminal / steps.length)),
    hasFailedStep: failed > 0,
  };
}

export function countRunnableSteps(
  steps: readonly TransferStep[],
  stepStates: Record<string, StepState>
): number {
  return steps.filter((step) => {
    const status = stepStates[step.id]?.status;
    return status !== 'done' && status !== 'skipped';
  }).length;
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
  return next;
}

export function insertStepsAfter(
  steps: readonly TransferStep[],
  afterId: string,
  toInsert: readonly TransferStep[]
): TransferStep[] {
  const index = steps.findIndex((step) => step.id === afterId);
  if (index === -1) return [...steps];
  return [...steps.slice(0, index + 1), ...toInsert, ...steps.slice(index + 1)];
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
    return { status: 'skip', minRequired };
  }

  if (requestedSatAmount + feeHeadroom > sourceBalance) {
    return {
      status: 'capped',
      amount: toSafeSatAmount(sourceBalance - feeHeadroom) ?? 0,
      capped: true,
    };
  }

  return {
    status: 'ready',
    amount: requestedSatAmount,
    capped: false,
  };
}

export function normalizeRebalanceTransferError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'Transfer failed');
  const lower = message.toLowerCase();

  if (message.includes('lnd is not ready') || message.includes('not ready for')) {
    return 'Mint Lightning node is not ready. The mint may be starting up or syncing. Try again in a few minutes.';
  }
  if (lower.includes('no_route') || lower.includes('ran out of routes')) {
    return 'No Lightning route found. No middleman route available either.';
  }
  if (message.includes('FAILURE_REASON_TIMEOUT')) {
    return 'Lightning payment timed out. The mint may be slow to respond.';
  }
  if (message.includes('invoice expired') || message.includes('EXPIRED')) {
    return 'Invoice expired before payment could complete. Please retry.';
  }
  if (lower.includes('insufficient')) {
    return 'Insufficient balance or liquidity for this transfer.';
  }

  return message;
}
