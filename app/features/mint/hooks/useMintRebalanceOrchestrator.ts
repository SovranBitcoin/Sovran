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
import { activePubkey } from '@/shared/stores/global/profileStore';
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
  swapHistoryOf,
  type StartedGroup,
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
  /** The account the run, and its group, were started for. */
  account: string | undefined;
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
  const swapGroupRef = useRef<StartedGroup | null>(null);
  /** What the group's toast was started with, to show it again for a retry. */
  const toastStartRef = useRef<ToastStart | null>(null);
  const swapLegIdByStepIdRef = useRef<Record<string, string>>({});
  const isRunActive = useCallback(
    (run: OwnedRun) => runRef.current === run && managerRef.current === manager,
    [manager]
  );

  /**
   * Make a new run this screen's current one, or null when it may not start:
   * this screen owns a run, or another screen's run owns a swap group. Decided
   * from ownership, not the toast, which the person can swipe away while a run
   * goes on. Every start goes through here. `prepare` runs once the run is
   * allowed and before it is held (a new swap starts its group there).
   *
   * Its swap group reads as running while it is; a group an earlier run ended
   * is reopened for it, with its toast (shown again if it was dismissed), so
   * the retry's end is the one they show.
   */
  const claimRun = useCallback((prepare?: () => void): OwnedRun | null => {
    if (runRef.current) return null;
    if (anySwapGroupHeld()) {
      cashuLog.info('mint.rebalance.start_blocked_by_active_swap');
      return null;
    }
    prepare?.();
    const groupId = swapGroupRef.current?.id ?? null;
    const account = swapGroupRef.current ? swapGroupRef.current.account : activePubkey();
    if (groupId) swapHistoryOf(account)?.reopenGroup(groupId);
    const toast = toastFor(groupId);
    if (toast) toast.resume();
    else if (toastStartRef.current) showToast(toastStartRef.current, stepStatesRef.current);
    const run = { groupId, account, release: groupId ? holdSwapGroup(groupId) : () => {} };
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
  const closeCancelled = useCallback((groupId: string | null, account: string | undefined) => {
    setRunStatus('cancelled');
    if (groupId) swapHistoryOf(account)?.finalizeGroup(groupId, 'cancelled');
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
        group: swapGroupRef.current,
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
          closeCancelled(run.groupId, run.account);
          toast?.cancel();
          return;
        }
        setRunStatus('finished');
        if (run.groupId) swapHistoryOf(run.account)?.finalizeGroup(run.groupId, 'finished');
        if (result.anyFailed) toast?.fail();
        else if (result.anyPending) toast?.settleUnknown(PAYMENT_PENDING_DETAIL);
        else toast?.complete();
      };
      const callbacks: Parameters<StartRun>[0] = {
        isActive: () => isRunActive(currentRun()),
        // Once another account is open the run starts nothing more: it would
        // pay from this account's wallet and hold every account's swaps back.
        // A leg in flight goes on; the saved group is left running, for this
        // account's reconcile the next time it is open.
        beforeLegOpens: () => {
          const run = currentRun();
          if (activePubkey() === run.account || !giveUpRun(run)) return;
          cashuLog.info('mint.rebalance.run_ended_other_account', { groupId: run.groupId });
          setRunStatus('cancelled');
          toastFor(run.groupId)?.cancel();
        },
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
          closeCancelled(run.groupId, run.account);
          toastFor(run.groupId)?.fail(describeError(err, 'cashu').text);
        }
        throw err;
      }
    },
    [closeCancelled, giveUpRun, isRunActive, sinkFor]
  );

  const handleStart = useCallback(() => {
    // Freeze the plan snapshot
    const snapshot = computedPlan;
    // A prior screen mount may still be running a swap (the person backed out
    // and reopened): a second one would overlap coco's mint/melt services.
    const run = claimRun(() => {
      setRunPlan(snapshot);

      // Start a swap group for this run (used for Transactions grouping)
      swapLegIdByStepIdRef.current = {};
      const groupId = useSwapTransactionsStore.getState().startGroup({ unit, title: 'Swap' });
      swapGroupRef.current = { id: groupId, account: activePubkey() };
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
    });
    if (!run) return;
    setRunStatus('running');

    // Run without awaiting to keep the UI responsive; the snapshot steps stay
    // stable while the live plan recomputes. `runSteps` already reported the
    // failure on the toast.
    runSteps(
      (callbacks) => engine.runTransfers(snapshot.steps, callbacks),
      () => run
    ).catch((error: unknown) => {
      cashuLog.warn('mint.rebalance.run_failed', { groupId: run.groupId, error });
    });
  }, [claimRun, computedPlan, runSteps, unit, engine]);

  const handleRetry = useCallback(
    async (step: TransferStep) => {
      const run = claimRun();
      if (!run) return;
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
            beforeLegOpens: callbacks.beforeLegOpens,
            sink: callbacks.sinkFor(step),
          });
          callbacks.onTransferSettled?.(step, outcome);
          return toRunResult(outcome);
        },
        () => run
      );
    },
    [claimRun, engine, runSteps, updateStepState]
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
    const run = claimRun();
    if (!run) return;
    setRunStatus('running');

    // Reset only failed steps to pending
    setStepStates((prev) => resetFailedStepStates(prev, runPlan.steps));

    const steps = runPlan.steps;
    await runSteps(
      (callbacks) => engine.runTransfers(steps, callbacks),
      () => run
    );
  }, [claimRun, runPlan, runSteps, engine]);

  const handleRouteThrough = useCallback(
    async (step: TransferStep) => {
      if (!runPlan) return;
      const suggestion = stepStatesRef.current[step.id]?.routeSuggestion;
      if (!suggestion || suggestion.status !== 'found' || !suggestion.path) return;

      const chainPath = suggestion.path;
      if (chainPath.length < 3) return; // Need at least A → via → B

      // Held while the intermediaries are trusted, so nothing else starts.
      const run = claimRun();
      if (!run) return;

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
              // A Cancel pressed while the intermediaries were being trusted
              // gave the run up, and another swap may hold one now: the late
              // answer is dropped, and the engine, finding the run no longer
              // active, runs nothing and gives the trust back.
              if (!isRunActive(run)) return;
              insertChainRows(step.id, hops);
              setRunStatus('running');
            },
          }),
        () => run
      );
    },
    [claimRun, isRunActive, runPlan, runSteps, engine, insertChainRows]
  );

  const handleCancelRun = useCallback(() => {
    // Stops scheduling new steps and UI updates; an in-flight melt continues
    // and coco settles it.
    const run = runRef.current;
    if (run) giveUpRun(run);
    const groupId = run?.groupId ?? swapGroupRef.current?.id ?? null;
    closeCancelled(groupId, run ? run.account : swapGroupRef.current?.account);
    // Flip the SwapStatusToast to its terminal 'cancelled' state; the runner
    // returns early on abort, so its complete()/fail() never fires.
    toastFor(groupId)?.cancel();
  }, [closeCancelled, giveUpRun]);

  return {
    plan,
    runPlan,
    stepStates,
    runStatus,
    swapGroupId: swapGroupRef.current?.id ?? null,
    handleStart,
    handleRetry,
    handleSkip,
    handleRetryFailed,
    handleRouteThrough,
    handleCancelRun,
  };
}
