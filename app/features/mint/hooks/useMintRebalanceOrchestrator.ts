import { describeError } from '@/shared/lib/errors';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { useManager } from '@cashu/coco-react';
import {
  createRebalanceEngine,
  createRebalanceLock,
  insertStepsAfter,
  type RebalanceEngine,
  type RebalanceTransferOutcome,
} from 'wallet';

import { extractDomain } from '@/shared/lib/url';
import { mintLocalId } from '@/shared/lib/id';
import { cashuLog } from '@/shared/lib/logger';
import { swapStatusPopup } from '@/shared/lib/popup';
import { useSwapTransactionsStore } from '@/shared/stores/profile/swapTransactionsStore';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import { anySwapGroupHeld, holdSwapGroup } from '@/shared/lib/cashu/swapGroupPhase';
import type { MiddlemanRoutingSettings } from '@/shared/stores/global/settingsStore';
import {
  MIN_FEE_RESERVE,
  type TransferStep,
  type RebalancePlan,
  type StepState,
} from '@/features/mint/components/rebalance';
import {
  applyInsertedChainStates,
  createInitialStepStates,
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

type RunResult = Awaited<ReturnType<RebalanceEngine['runTransfers']>>;
type StartRun = (
  callbacks: Parameters<RebalanceEngine['runTransfers']>[1],
  report: (result: RunResult) => void
) => Promise<RunResult>;

/**
 * The run this screen owns. While it is the screen's current run the engine
 * keeps going and the swap group reads as running; ending it, by its report,
 * a throw or Cancel, gives the group up.
 */
interface OwnedRun {
  groupId: string | null;
  release: () => void;
}

/** The Swap status toast, when it belongs to this group. */
function toastFor(groupId: string | null) {
  const swapStatus = useSwapStatusStore.getState();
  return groupId && swapStatus.active?.meta.groupId === groupId ? swapStatus : null;
}

type ToastStart = Parameters<ReturnType<typeof useSwapStatusStore.getState>['start']>[0];

/** Show the Swap status toast from `start`, with each leg as the screen has it now. */
function showToast(start: ToastStart, stepStates: Record<string, StepState>) {
  const toast = useSwapStatusStore.getState();
  toast.start(start);
  for (const { id } of start.legs) {
    const step = stepStates[id];
    if (step?.status === 'done') toast.setLegDone(id);
    else if (step?.status === 'skipped') toast.setLegSkipped(id);
    else if (step?.status === 'failed') toast.setLegFailed(id, step.errorMessage);
    // Money left and has not been seen to arrive: the run left these active.
    else if (step?.status === 'settling' || step?.status === 'paymentPending') {
      toast.setActiveLeg(id);
    }
  }
  swapStatusPopup();
}

/** Report a settled transfer on the unified Swap status toast. */
function reportSwapLeg(
  toast: ReturnType<typeof toastFor>,
  step: TransferStep,
  outcome: RebalanceTransferOutcome
) {
  if (!toast) return;
  if (outcome.status === 'done') toast.setLegDone(step.id);
  else if (outcome.status === 'skipped') toast.setLegSkipped(step.id);
  else if (outcome.status === 'failed') {
    toast.setLegFailed(step.id, describeError(outcome.error, 'cashu').text);
  }
}

/** One transfer's outcome as the result of a run of that transfer alone. */
function toRunResult(outcome: RebalanceTransferOutcome): RunResult {
  switch (outcome.status) {
    case 'aborted':
      return { status: 'aborted' };
    case 'done':
    case 'skipped':
      return { status: 'finished', anyFailed: false, anyPending: false };
    case 'pending':
    case 'settling':
      return { status: 'finished', anyFailed: false, anyPending: true };
    case 'failed':
    case 'busy':
      return { status: 'finished', anyFailed: true, anyPending: false };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
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

  const runRef = useRef<OwnedRun | null>(null);
  const swapGroupIdRef = useRef<string | null>(null);
  /** What the group's toast was started with, to show it again for a retry. */
  const toastStartRef = useRef<ToastStart | null>(null);
  const swapLegIdByStepIdRef = useRef<Record<string, string>>({});
  const isRunActive = useCallback(
    (run: OwnedRun) => runRef.current === run && managerRef.current === manager,
    [manager]
  );

  /**
   * Whether this screen may start a run: it owns none, and no other screen's
   * run owns a swap group. Decided from ownership, not the toast, which the
   * person can swipe away while a run goes on.
   */
  const mayStartRun = useCallback(() => {
    if (runRef.current) return false;
    if (!anySwapGroupHeld()) return true;
    cashuLog.info('mint.rebalance.start_blocked_by_active_swap');
    return false;
  }, []);

  /**
   * Make a new run this screen's current one. Its swap group reads as running
   * while it is; a group an earlier run ended is reopened for it, with its
   * toast (shown again if it was dismissed), so the retry's end is the one
   * they show.
   */
  const claimRun = useCallback((): OwnedRun => {
    const groupId = swapGroupIdRef.current;
    if (groupId) useSwapTransactionsStore.getState().reopenGroup(groupId);
    const toast = toastFor(groupId);
    if (toast) toast.resume();
    else if (toastStartRef.current) showToast(toastStartRef.current, stepStatesRef.current);
    const run = { groupId, release: groupId ? holdSwapGroup(groupId) : () => {} };
    runRef.current = run;
    return run;
  }, []);

  /** Stop owning `run`; false when it was no longer the current run (Cancel ended it). */
  const giveUpRun = useCallback((run: OwnedRun) => {
    run.release();
    if (runRef.current !== run) return false;
    runRef.current = null;
    return true;
  }, []);

  /** End the swap group and the screen for a run that did not get through its steps. */
  const closeCancelled = useCallback((groupId: string | null) => {
    setRunStatus('cancelled');
    if (groupId) useSwapTransactionsStore.getState().finalizeGroup(groupId, 'cancelled');
  }, []);

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

  /**
   * Run one engine action to its end and report it. `start` is the action;
   * `currentRun` is read when the engine asks whether the run is still
   * wanted, because a rerouted run is claimed again once its mints are
   * trusted. `start` may report the result itself before it returns: a
   * rerouted run does, so the screen is not kept waiting while trust is given
   * back.
   */
  const runSteps = useCallback(
    async (start: StartRun, currentRun: () => OwnedRun) => {
      let reported = false;
      // Reporting ends the run for the screen, the swap history group and the
      // toast, unless Cancel already ended it.
      const report = (result: RunResult) => {
        if (reported) return;
        reported = true;
        const run = currentRun();
        if (!giveUpRun(run)) return;
        const toast = toastFor(run.groupId);
        if (result.status === 'aborted') {
          // The wallet changed under the run (an account switch).
          closeCancelled(run.groupId);
          toast?.cancel();
          return;
        }
        setRunStatus('finished');
        if (run.groupId) {
          useSwapTransactionsStore.getState().finalizeGroup(run.groupId, 'finished');
        }
        if (result.anyFailed) toast?.fail();
        else if (result.anyPending) toast?.settleUnknown(PAYMENT_PENDING_DETAIL);
        else toast?.complete();
      };
      const callbacks: Parameters<StartRun>[0] = {
        isActive: () => isRunActive(currentRun()),
        isSettled: (stepId) => {
          const status = stepStatesRef.current[stepId]?.status;
          // Settling and payment-pending count: the money has left or may
          // still leave, so the step must never run again.
          return (
            status === 'done' ||
            status === 'skipped' ||
            status === 'settling' ||
            status === 'paymentPending'
          );
        },
        sinkFor,
        // Flip the toast pip to "active" before the transfer starts.
        onTransferStart: (step) => toastFor(currentRun().groupId)?.setActiveLeg(step.id),
        onTransferSettled: (step, outcome) =>
          reportSwapLeg(toastFor(currentRun().groupId), step, outcome),
      };
      try {
        report(await start(callbacks, report));
      } catch (err) {
        const run = currentRun();
        if (giveUpRun(run)) {
          closeCancelled(run.groupId);
          toastFor(run.groupId)?.fail(describeError(err, 'cashu').text);
        }
        throw err;
      }
    },
    [closeCancelled, giveUpRun, isRunActive, sinkFor]
  );

  const handleStart = useCallback(() => {
    // A prior screen mount may still be running a swap (the person backed out
    // and reopened): a second one would overlap coco's mint/melt services.
    if (!mayStartRun()) return;

    // Freeze the plan snapshot
    const snapshot = computedPlan;
    setRunPlan(snapshot);

    // Start a swap group for this run (used for Transactions grouping)
    swapLegIdByStepIdRef.current = {};
    const groupId = useSwapTransactionsStore.getState().startGroup({ unit, title: 'Swap' });
    swapGroupIdRef.current = groupId;
    const initialStates = createInitialStepStates(snapshot.steps);
    stepStatesRef.current = initialStates;
    setStepStates(initialStates);

    // The unified Swap status toast, which `claimRun` shows: while it is
    // running, `usePaymentStatusListener` skips per-op toasts, so the person
    // sees one progress notification instead of N.
    toastStartRef.current = {
      id: groupId,
      legs: snapshot.steps.map((s) => ({
        id: s.id,
        label: `${extractDomain(s.fromMintUrl)} → ${extractDomain(s.toMintUrl)}`,
      })),
      meta: {
        unit,
        totalAmount: snapshot.steps.reduce((sum, s) => sum + (s.amount ?? 0), 0),
        // Backs the toast's "View" button so completion → tap → SwapTransactionScreen.
        groupId,
      },
    };
    const run = claimRun();
    setRunStatus('running');

    // Run without awaiting to keep the UI responsive; the snapshot steps stay
    // stable while the live plan recomputes. `runSteps` already reported the
    // failure on the toast.
    runSteps(
      (callbacks) => engine.runTransfers(snapshot.steps, callbacks),
      () => run
    ).catch((error: unknown) => {
      cashuLog.warn('mint.rebalance.run_failed', { groupId, error });
    });
  }, [claimRun, computedPlan, mayStartRun, runSteps, unit, engine]);

  const handleRetry = useCallback(
    async (step: TransferStep) => {
      if (!mayStartRun()) return;

      const run = claimRun();
      setRunStatus('running');
      updateStepState(step.id, {
        status: 'pending',
        errorMessage: undefined,
        routeSuggestion: undefined,
      });
      await runSteps(
        async (callbacks) => {
          const outcome = await engine.executeTransfer(step, {
            isActive: callbacks.isActive,
            sink: callbacks.sinkFor(step),
          });
          callbacks.onTransferSettled?.(step, outcome);
          return toRunResult(outcome);
        },
        () => run
      );
    },
    [claimRun, engine, mayStartRun, runSteps, updateStepState]
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
    if (!mayStartRun()) return;

    const run = claimRun();
    setRunStatus('running');

    // Reset only failed steps to pending
    setStepStates((prev) => resetFailedStepStates(prev, runPlan.steps));

    const steps = runPlan.steps;
    await runSteps(
      (callbacks) => engine.runTransfers(steps, callbacks),
      () => run
    );
  }, [claimRun, mayStartRun, runPlan, runSteps, engine]);

  const handleRouteThrough = useCallback(
    async (step: TransferStep) => {
      if (!runPlan) return;
      if (!mayStartRun()) return;

      const suggestion = stepStatesRef.current[step.id]?.routeSuggestion;
      if (!suggestion || suggestion.status !== 'found' || !suggestion.path) return;

      const chainPath = suggestion.path;
      if (chainPath.length < 3) return; // Need at least A → via → B

      // Held while the intermediaries are trusted, so nothing else starts.
      let run = claimRun();

      // One engine action: it makes a step per hop, trusts the intermediaries
      // for the run, and runs them. The original step stays visible (skipped)
      // with one row per hop after it.
      const steps = runPlan.steps;
      await runSteps(
        (callbacks, report) =>
          engine.routeThrough(step, chainPath, steps, {
            ...callbacks,
            onRunFinished: report,
            makeId: mintLocalId,
            onRerouted: (hops) => {
              insertChainRows(step.id, hops);
              // The run starts here. A Cancel pressed while the intermediaries
              // were being trusted does not stop it: it is claimed again.
              if (runRef.current !== run) run = claimRun();
              setRunStatus('running');
            },
          }),
        () => run
      );
    },
    [claimRun, mayStartRun, runPlan, runSteps, engine, insertChainRows]
  );

  const handleCancelRun = useCallback(() => {
    // Stops scheduling new steps and UI updates; an in-flight melt continues
    // and coco settles it.
    const run = runRef.current;
    if (run) giveUpRun(run);
    const groupId = run?.groupId ?? swapGroupIdRef.current;
    closeCancelled(groupId);
    // Flip the SwapStatusToast to its terminal 'cancelled' state; the runner
    // returns early on abort, so its complete()/fail() never fires.
    toastFor(groupId)?.cancel();
  }, [closeCancelled, giveUpRun]);

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
