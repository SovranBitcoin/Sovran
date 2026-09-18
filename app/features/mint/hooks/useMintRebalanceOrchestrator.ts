import { describeError } from '@/shared/lib/errors';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { useManager } from '@cashu/coco-react';
import { createRebalanceEngine, createRebalanceLock, type RebalanceTransferOutcome } from 'wallet';

import { extractDomain } from '@/shared/lib/url';
import { mintLocalId } from '@/shared/lib/id';
import { cashuLog } from '@/shared/lib/logger';
import { swapStatusPopup } from '@/shared/lib/popup';
import { useSwapTransactionsStore } from '@/shared/stores/profile/swapTransactionsStore';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import type { MiddlemanRoutingSettings } from '@/shared/stores/global/settingsStore';
import {
  MIN_FEE_RESERVE,
  type TransferStep,
  type RebalancePlan,
  type StepState,
} from '@/features/mint/components/rebalance';
import {
  applyInsertedChainStates,
  createChainSteps,
  createInitialStepStates,
  insertStepsAfter,
  mergeStepState,
  resetFailedStepStates,
} from '@/features/mint/lib/rebalanceRunState';
import { findRebalanceRouteCandidates } from '@/features/mint/lib/rebalanceRouteCandidates';
import {
  createRebalanceStepSink,
  PAYMENT_PENDING_DETAIL,
} from '@/features/mint/lib/rebalanceStepSink';
import { createRebalanceWalletPort } from '@/features/mint/lib/rebalanceWalletPort';

type RebalanceRunStatus = 'idle' | 'running' | 'finished' | 'cancelled';

interface MintLite {
  mintUrl: string;
}

interface UseMintRebalanceOrchestratorArgs {
  unit: string;
  computedPlan: RebalancePlan;
  trustedMints: MintLite[];
  mintInfoMap: Record<string, GetInfoResponse | null>;
  middlemanRouting: MiddlemanRoutingSettings;
  minTransferThreshold: number;
}

interface UseMintRebalanceOrchestratorResult {
  plan: RebalancePlan;
  runPlan: RebalancePlan | null;
  stepStates: Record<string, StepState>;
  runStatus: RebalanceRunStatus;
  swapGroupId: string | null;
  handleStart: () => void;
  handleRetry: (step: TransferStep) => Promise<void>;
  handleSkip: (step: TransferStep) => void;
  handleRetryFailed: () => Promise<void>;
  handleRouteThrough: (step: TransferStep) => Promise<void>;
  handleCancelRun: () => void;
}

/** Report a settled transfer on the unified Swap status toast. */
function reportSwapLeg(step: TransferStep, outcome: RebalanceTransferOutcome) {
  const swapStatus = useSwapStatusStore.getState();
  if (outcome.status === 'done') swapStatus.setLegDone(step.id);
  else if (outcome.status === 'skipped') swapStatus.setLegSkipped(step.id);
  else if (outcome.status === 'failed') {
    swapStatus.setLegFailed(step.id, describeError(outcome.error, 'cashu').text);
  }
}

/**
 * Screen binding for the mint rebalance engine in `wallet`: freezes the plan,
 * starts and cancels runs, and maps engine progress onto row state, the swap
 * history group and the Swap status toast.
 */
export function useMintRebalanceOrchestrator({
  unit,
  computedPlan,
  trustedMints,
  mintInfoMap,
  middlemanRouting,
  minTransferThreshold,
}: UseMintRebalanceOrchestratorArgs): UseMintRebalanceOrchestratorResult {
  const manager = useManager();
  const managerRef = useRef(manager);
  useEffect(() => {
    managerRef.current = manager;
  }, [manager]);

  const [runPlan, setRunPlan] = useState<RebalancePlan | null>(null);
  const [stepStates, setStepStates] = useState<Record<string, StepState>>({});
  const stepStatesRef = useRef<Record<string, StepState>>({});
  const [runStatus, setRunStatus] = useState<RebalanceRunStatus>('idle');
  // One lock per screen: transfers from a retry never overlap a running one.
  const [lock] = useState(createRebalanceLock);

  const runIdRef = useRef(0);
  const abortRef = useRef(false);
  const isRunningRef = useRef(false);
  const swapGroupIdRef = useRef<string | null>(null);
  const swapLegIdByStepIdRef = useRef<Record<string, string>>({});
  const isRunActive = useCallback(
    (runId: number) =>
      !abortRef.current && runIdRef.current === runId && managerRef.current === manager,
    [manager]
  );

  const plan = useMemo(() => runPlan ?? computedPlan, [runPlan, computedPlan]);

  useEffect(() => {
    stepStatesRef.current = stepStates;
  }, [stepStates]);

  // No unmount-abort: the run is a closure-bound async loop, and
  // `useSwapStatusStore` + the unified SwapStatusToast both live outside the
  // React tree. The user can back out mid-swap and the swap finishes in the
  // background — the toast keeps reporting progress, and its "View" button
  // opens SwapTransactionScreen. `setStepStates` after unmount is a silent
  // no-op in React 19.

  const updateStepState = useCallback((stepId: string, update: Partial<StepState>) => {
    setStepStates((prev) => mergeStepState(prev, stepId, update));
  }, []);

  /** Show hop rows after `afterStepId` (marked skipped); the runner reads the ref at once. */
  const insertChainRows = useCallback(
    (afterStepId: string, hopSteps: TransferStep[], routingDetail?: string) => {
      setRunPlan((prev) =>
        prev ? { ...prev, steps: insertStepsAfter(prev.steps, afterStepId, hopSteps) } : prev
      );
      const nextStates = applyInsertedChainStates(
        stepStatesRef.current,
        afterStepId,
        hopSteps,
        routingDetail === undefined ? {} : { routingDetail }
      );
      stepStatesRef.current = nextStates;
      setStepStates(nextStates);
    },
    []
  );

  const engine = useMemo(() => {
    const trustedMintUrls = trustedMints.map((mint) => mint.mintUrl);
    return createRebalanceEngine({
      wallet: createRebalanceWalletPort(manager, unit),
      findRoutes: (fromMintUrl, toMintUrl) =>
        findRebalanceRouteCandidates({
          fromMintUrl,
          toMintUrl,
          planSteps: runPlan?.steps ?? null,
          trustedMintUrls,
          mintInfoMap,
          middlemanRouting,
        }),
      trustedMintUrls: new Set(trustedMintUrls),
      minTransferThreshold,
      minFeeReserve: MIN_FEE_RESERVE,
      lock,
      logger: cashuLog,
    });
  }, [
    manager,
    unit,
    runPlan,
    trustedMints,
    mintInfoMap,
    middlemanRouting,
    minTransferThreshold,
    lock,
  ]);

  const sinkFor = useCallback(
    (step: TransferStep) =>
      createRebalanceStepSink({
        step,
        groupId: swapGroupIdRef.current,
        swapLegIds: swapLegIdByStepIdRef.current,
        updateStepState,
        insertChainRows,
      }),
    [updateStepState, insertChainRows]
  );

  const runSteps = useCallback(
    async (steps: TransferStep[], runId: number) => {
      try {
        const result = await engine.runTransfers(steps, {
          isActive: () => isRunActive(runId),
          isSettled: (stepId) => {
            const status = stepStatesRef.current[stepId]?.status;
            return status === 'done' || status === 'skipped';
          },
          sinkFor,
          // Flip the toast pip to "active" before the transfer starts.
          onTransferStart: (step) => useSwapStatusStore.getState().setActiveLeg(step.id),
          onTransferSettled: reportSwapLeg,
        });
        if (result.status === 'aborted') return;

        setRunStatus('finished');
        if (swapGroupIdRef.current) {
          useSwapTransactionsStore.getState().finalizeGroup(swapGroupIdRef.current, 'finished');
        }
        // Retry runs may have no active swap (handleStart's start() not
        // called); the store actions also early-return on `!active`.
        const swapStatus = useSwapStatusStore.getState();
        if (swapStatus.active) {
          if (result.anyFailed) swapStatus.fail();
          else if (result.anyPending) swapStatus.settleUnknown(PAYMENT_PENDING_DETAIL);
          else swapStatus.complete();
        }
      } catch (err) {
        if (useSwapStatusStore.getState().active) {
          useSwapStatusStore.getState().fail(describeError(err, 'cashu').text);
        }
        throw err;
      } finally {
        isRunningRef.current = false;
      }
    },
    [engine, isRunActive, sinkFor]
  );

  const handleStart = useCallback(() => {
    // Per-instance ref-based guard (this screen mount).
    if (isRunningRef.current) return;
    if (runStatus === 'running') return;
    // Cross-instance guard: a prior screen mount may still be running an
    // orchestration (the user backed out and reopened). Refuse to start a
    // second concurrent swap so coco's mint/melt services don't overlap.
    if (useSwapStatusStore.getState().active?.state === 'running') {
      cashuLog.info('mint.rebalance.start_blocked_by_active_swap');
      return;
    }

    isRunningRef.current = true;
    abortRef.current = false;
    const runId = (runIdRef.current += 1);

    // Freeze the plan snapshot
    const snapshot = computedPlan;
    setRunPlan(snapshot);

    // Start a swap group for this run (used for Transactions grouping)
    swapLegIdByStepIdRef.current = {};
    swapGroupIdRef.current = useSwapTransactionsStore
      .getState()
      .startGroup({ unit, title: 'Swap' });

    setStepStates(createInitialStepStates(snapshot.steps));
    setRunStatus('running');

    // Wire the unified Swap status toast — `usePaymentStatusListener` reads
    // `useSwapStatusStore.active` and skips per-op toasts while this is
    // running, so the user sees one progress notification instead of N.
    const totalAmount = snapshot.steps.reduce((sum, s) => sum + (s.amount ?? 0), 0);
    useSwapStatusStore.getState().start({
      id: `swap-${runId}-${Date.now()}`,
      legs: snapshot.steps.map((s) => ({
        id: s.id,
        label: `${extractDomain(s.fromMintUrl)} → ${extractDomain(s.toMintUrl)}`,
      })),
      meta: {
        unit,
        totalAmount,
        // Backs the toast's "View" button so completion → tap → SwapTransactionScreen.
        groupId: swapGroupIdRef.current ?? undefined,
      },
    });
    swapStatusPopup();

    // Run without awaiting to keep the UI responsive; the snapshot steps stay
    // stable while the live plan recomputes. `runSteps` already reported the
    // failure on the toast.
    runSteps(snapshot.steps, runId).catch((error: unknown) => {
      cashuLog.warn('mint.rebalance.run_failed', { runId, error });
    });
  }, [computedPlan, runStatus, runSteps, unit]);

  const handleRetry = useCallback(
    async (step: TransferStep) => {
      if (isRunningRef.current) return;
      if (runStatus === 'running') return;

      isRunningRef.current = true;
      abortRef.current = false;
      const runId = (runIdRef.current += 1);
      setRunStatus('running');
      updateStepState(step.id, {
        status: 'pending',
        errorMessage: undefined,
        routeSuggestion: undefined,
      });
      try {
        const outcome = await engine.executeTransfer(step, {
          isActive: () => isRunActive(runId),
          sink: sinkFor(step),
        });
        reportSwapLeg(step, outcome);
      } finally {
        isRunningRef.current = false;
      }
      setRunStatus('finished');
    },
    [engine, isRunActive, sinkFor, updateStepState, runStatus]
  );

  const handleSkip = useCallback(
    (step: TransferStep) => {
      if (runStatus === 'running') return;
      updateStepState(step.id, { status: 'skipped' });
    },
    [updateStepState, runStatus]
  );

  const handleRetryFailed = useCallback(async () => {
    if (!runPlan) return;
    if (isRunningRef.current) return;
    if (runStatus === 'running') return;

    isRunningRef.current = true;
    abortRef.current = false;
    const runId = (runIdRef.current += 1);
    setRunStatus('running');

    // Reset only failed steps to pending
    setStepStates((prev) => resetFailedStepStates(prev, runPlan.steps));

    await runSteps(runPlan.steps, runId);
  }, [runPlan, runStatus, runSteps]);

  const handleRouteThrough = useCallback(
    async (step: TransferStep) => {
      if (!runPlan) return;
      if (isRunningRef.current) return;
      if (runStatus === 'running') return;

      const suggestion = stepStatesRef.current[step.id]?.routeSuggestion;
      if (!suggestion || suggestion.status !== 'found' || !suggestion.path) return;

      const chainPath = suggestion.path;
      if (chainPath.length < 3) return; // Need at least A → via → B

      isRunningRef.current = true;

      // The original step stays visible (skipped); one row per hop follows it.
      const rerouteSteps = createChainSteps({
        baseStep: step,
        chainPath,
        chainId: mintLocalId('chain'),
        idPrefix: `reroute-${step.id}`,
        makeId: mintLocalId,
      });
      const nextSteps = insertStepsAfter(runPlan.steps, step.id, rerouteSteps);

      // Coco requires intermediaries to be trusted; the engine trusts the
      // ones the user has not, only for this run.
      await engine.withTemporaryTrust(
        chainPath,
        { sink: sinkFor(step), warnLegId: rerouteSteps[rerouteSteps.length - 1]?.id },
        async () => {
          insertChainRows(step.id, rerouteSteps);
          abortRef.current = false;
          const runId = (runIdRef.current += 1);
          setRunStatus('running');
          await runSteps(nextSteps, runId);
        }
      );
    },
    [runPlan, runStatus, runSteps, engine, sinkFor, insertChainRows]
  );

  const handleCancelRun = useCallback(() => {
    // Stops scheduling new steps and UI updates; an in-flight melt continues
    // and coco settles it.
    abortRef.current = true;
    runIdRef.current += 1;
    isRunningRef.current = false;
    setRunStatus('cancelled');

    if (swapGroupIdRef.current) {
      useSwapTransactionsStore.getState().finalizeGroup(swapGroupIdRef.current, 'cancelled');
    }
    // Flip the SwapStatusToast to its terminal 'cancelled' state; the runner
    // returns early on abort, so its complete()/fail() never fires.
    useSwapStatusStore.getState().cancel();
  }, []);

  return {
    plan,
    runPlan,
    stepStates,
    runStatus,
    swapGroupId: swapGroupIdRef.current,
    handleStart,
    handleRetry,
    handleSkip,
    handleRetryFailed,
    handleRouteThrough,
    handleCancelRun,
  };
}
