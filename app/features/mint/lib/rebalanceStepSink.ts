import type {
  RebalanceEventSink,
  RebalanceLegStatus,
  RebalanceLegUpdate,
  RebalanceRoutingInfo,
} from 'wallet';

import {
  formatStrandedRoutingDetail,
  type StepState,
  type TransferStep,
} from '@/features/mint/components/rebalance';
import {
  createChainSteps,
  formatCandidateRoutingDetail,
} from '@/features/mint/lib/rebalanceRunState';
import { describeError } from '@/shared/lib/errors';
import { mintLocalId } from '@/shared/lib/id';
import { extractDomain } from '@/shared/lib/url';
import {
  useSwapTransactionsStore,
  type SwapLegLocalStatus,
} from '@/shared/stores/profile/swapTransactionsStore';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';

/** Row copy for a melt the wallet sent but could not yet confirm. */
export const PAYMENT_PENDING_DETAIL =
  'Payment pending. Please wait and reopen later; the app will recover this operation automatically.';

function routingToStepState(routing: RebalanceRoutingInfo | null): Partial<StepState> {
  if (!routing) return { routingDetail: undefined };
  switch (routing.kind) {
    case 'searching':
      return {
        routingDetail: 'Searching for middleman route…',
        routeSuggestion: { status: 'searching' },
      };
    case 'candidate':
      return {
        routeSuggestion: { status: 'found', path: routing.path, pathNames: routing.pathNames },
        routingDetail: formatCandidateRoutingDetail({
          routeIndex: routing.index,
          routeCount: routing.count,
          pathNames: routing.pathNames,
        }),
      };
    case 'hop':
      return {
        routingDetail: `Hop ${routing.hopIndex + 1}/${routing.hopCount}: ${extractDomain(routing.fromMintUrl)} → ${extractDomain(routing.toMintUrl)}`,
      };
    case 'stranded':
      return { routingDetail: formatStrandedRoutingDetail(routing.stranded) };
  }
}

/** Map an engine leg update onto the row state the rebalance screen renders. */
function legUpdateToStepState(update: RebalanceLegUpdate): Partial<StepState> {
  const next: Partial<StepState> = {};
  if ('routing' in update) Object.assign(next, routingToStepState(update.routing ?? null));
  if ('error' in update) {
    next.errorMessage =
      update.error == null ? undefined : describeError(update.error, 'cashu').text;
  }
  if (update.invoice !== undefined) next.invoice = update.invoice;
  if (update.operationId !== undefined) next.operationId = update.operationId;
  if (update.status === 'paymentPending') {
    // Still in flight: shown as sending, never as failed or retryable.
    next.status = 'melting';
    next.routingDetail = PAYMENT_PENDING_DETAIL;
  } else if (update.status) {
    next.status = update.status;
  }
  return next;
}

/** Persisted swap-leg status for an engine status; null when history keeps the previous one. */
function toSwapLegStatus(status: RebalanceLegStatus): SwapLegLocalStatus | null {
  switch (status) {
    case 'routing':
    case 'skipped':
      return null;
    case 'paymentPending':
      return 'melting';
    default:
      return status;
  }
}

/**
 * Record one plan step's engine events: row state for the screen, swap legs
 * and quote tags for transaction history, and inserted rows for middleman hops.
 */
export function createRebalanceStepSink({
  step,
  groupId,
  swapLegIds,
  updateStepState,
  insertChainRows,
}: {
  step: TransferStep;
  /** Swap group of the current run; null records row state only. */
  groupId: string | null;
  /** Engine leg id → persisted swap leg id, shared across a run's retries. */
  swapLegIds: Record<string, string>;
  updateStepState: (stepId: string, update: Partial<StepState>) => void;
  /** Show hop rows after `afterStepId`, which is marked skipped with `routingDetail`. */
  insertChainRows: (afterStepId: string, hopSteps: TransferStep[], routingDetail: string) => void;
}): RebalanceEventSink {
  const swapStore = () => useSwapTransactionsStore.getState();
  const chainByLeg: Record<string, { chainId?: string; hopIndex?: number }> = {};
  const swapAnnotation = (swapGroupId: string, legId: string, role: 'mint' | 'melt') => {
    const chain = chainByLeg[legId];
    // Colada groups the timeline by swapGroupId.
    return {
      swap: {
        groupId: swapGroupId,
        role,
        ...(chain?.chainId && { chainId: chain.chainId, hopIndex: chain.hopIndex }),
      },
    };
  };

  return {
    legOpened(legId, leg) {
      chainByLeg[legId] = { chainId: leg.chainId, hopIndex: leg.chainHopIndex };
      if (!groupId || swapLegIds[legId]) return;
      const swapLegId = swapStore().addLeg(groupId, leg);
      swapLegIds[legId] = swapLegId;
      swapStore().setLegStatus(groupId, swapLegId, { localStatus: 'pending' });
    },
    legUpdated(legId, update) {
      updateStepState(legId, legUpdateToStepState(update));
      const swapLegId = swapLegIds[legId];
      const localStatus = update.status ? toSwapLegStatus(update.status) : null;
      if (!groupId || !swapLegId || !localStatus) return;
      swapStore().setLegStatus(groupId, swapLegId, {
        localStatus,
        errorMessage:
          localStatus === 'failed' ? describeError(update.error, 'cashu').text : undefined,
      });
    },
    mintReceiptCreated(legId, receipt) {
      const swapLegId = swapLegIds[legId];
      if (!groupId || !swapLegId || !receipt.quoteId) return;
      swapStore().tagMintQuote(groupId, swapLegId, { quoteId: receipt.quoteId });
      setTransactionAnnotation(`quote:${receipt.quoteId}`, swapAnnotation(groupId, legId, 'mint'));
    },
    meltPrepared(legId, melt) {
      updateStepState(legId, { operationId: melt.id });
      const swapLegId = swapLegIds[legId];
      if (!groupId || !swapLegId || !melt.quoteId) return;
      swapStore().tagMelt(groupId, swapLegId, { quoteId: melt.quoteId, operationId: melt.id });
      setTransactionAnnotation(`quote:${melt.quoteId}`, swapAnnotation(groupId, legId, 'melt'));
    },
    routeAttemptStarted(stepId, { route, index, count }) {
      const chainId = mintLocalId('chain');
      const hopSteps = createChainSteps({
        baseStep: step,
        chainPath: route.path,
        chainId,
        idPrefix: `auto-route-${stepId}-${index}`,
        makeId: mintLocalId,
      });
      insertChainRows(
        stepId,
        hopSteps,
        formatCandidateRoutingDetail({
          routeIndex: index,
          routeCount: count,
          pathNames: route.pathNames,
        })
      );
      return { chainId, hopLegIds: hopSteps.map((hop) => hop.id) };
    },
  };
}
