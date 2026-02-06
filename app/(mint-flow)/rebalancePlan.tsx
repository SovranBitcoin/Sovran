/**
 * @fileoverview Rebalance Plan Screen
 *
 * Shows the computed rebalance plan and allows executing transfers
 * to move from current balances to desired distribution.
 *
 * Execution flow per step:
 * 1. Create mint invoice on receiver mint
 * 2. Melt from sender mint by paying that invoice
 * 3. Verify and refresh balances
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { View } from 'components/ui/View/View';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { ModalLayoutWrapper } from 'app/debugModal';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { useMints, useBalanceContext, useManager } from 'coco-cashu-react';
import { useMintManagement } from '@/hooks/coco/useMintManagement';
import { useLightningOperations } from '@/hooks/coco/useLightningOperations';
import { MIN_FEE_RESERVE } from 'components/blocks/rebalance';
import { useMintDistributionStore } from 'stores/mintDistributionStore';
import {
  RebalanceStepRow,
  computeRebalancePlan,
  isAlreadyBalanced,
  MIN_TRANSFER_THRESHOLD,
  buildSwapGraph,
  pickIntermediary,
  type TransferStep,
  type RebalancePlan,
  type StepStatus,
} from 'components/blocks/rebalance';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import Icon from 'assets/icons';
import { auditMint, type AuditMintResponse } from 'helper/apiClient';

interface StepState {
  status: StepStatus;
  errorMessage?: string;
  invoice?: string;
  operationId?: string;
  routeSuggestion?: {
    status: 'searching' | 'found' | 'none';
    viaMintUrl?: string;
    viaMintName?: string;
  };
}

function RebalancePlanScreen() {
  const { getPrimaryColor, getGreenColor } = useTheme();
  const primaryColor0 = useMemo(() => getPrimaryColor('0'), [getPrimaryColor]);
  const primaryColor300 = useMemo(() => getPrimaryColor('300'), [getPrimaryColor]);
  const primaryColor400 = useMemo(() => getPrimaryColor('400'), [getPrimaryColor]);
  const primaryColor700 = useMemo(() => getPrimaryColor('700'), [getPrimaryColor]);
  const primaryColor800 = useMemo(() => getPrimaryColor('800'), [getPrimaryColor]);
  const primaryColor950 = useMemo(() => getPrimaryColor('950'), [getPrimaryColor]);
  const greenColor = useMemo(() => getGreenColor('400'), [getGreenColor]);

  // Get params
  const params = useLocalSearchParams<{ unit: string }>();
  const unit = params.unit?.toLowerCase() || 'sat';

  // Mint data
  const { trustedMints } = useMints();
  const { balance: liveBalances } = useBalanceContext();
  const { getMintInfo } = useMintManagement();
  const manager = useManager();

  // Lightning operations for creating invoices
  const { requestLightningInvoice } = useLightningOperations();

  // Mint info state
  const [mintInfoMap, setMintInfoMap] = useState<Record<string, any>>({});

  // Distribution store
  const distributions = useMintDistributionStore((state) => state.distributions);
  const distribution = useMemo(() => distributions[unit] || {}, [distributions, unit]);

  // Get mints for this unit
  const mintsForUnit = useMemo(() => {
    return trustedMints.filter((mint) => {
      if (unit === 'sat') {
        if (!mint.mintInfo?.nuts?.['4']?.methods) return true;
        return mint.mintInfo.nuts['4'].methods.some(
          (method: any) => method.unit?.toLowerCase() === 'sat'
        );
      }
      if (!mint.mintInfo?.nuts?.['4']?.methods) return false;
      return mint.mintInfo.nuts['4'].methods.some(
        (method: any) => method.unit?.toLowerCase() === unit
      );
    });
  }, [trustedMints, unit]);

  const mintUrls = useMemo(() => mintsForUnit.map((m) => m.mintUrl), [mintsForUnit]);

  // Load mint info
  useEffect(() => {
    const loadMintInfo = async () => {
      const infoMap: Record<string, any> = {};
      for (const mint of trustedMints) {
        try {
          const info = await getMintInfo(mint.mintUrl);
          infoMap[mint.mintUrl] = info;
        } catch {
          infoMap[mint.mintUrl] = mint.mintInfo || null;
        }
      }
      setMintInfoMap(infoMap);
    };
    loadMintInfo();
  }, [trustedMints, getMintInfo]);

  // Compute the rebalance plan (live preview; do not use this for execution directly)
  const computedPlan = useMemo(() => {
    const mintBalances = mintUrls.map((mintUrl) => ({
      mintUrl,
      balance: liveBalances[mintUrl] || 0,
    }));
    return computeRebalancePlan(mintBalances, distribution, MIN_TRANSFER_THRESHOLD);
  }, [mintUrls, liveBalances, distribution]);

  /**
   * Freeze the plan snapshot on Start so that:
   * - completed steps never disappear
   * - step order and amounts remain stable during the run
   */
  const [runPlan, setRunPlan] = useState<RebalancePlan | null>(null);

  // Step execution state (only meaningful once a run has started)
  const [stepStates, setStepStates] = useState<Record<string, StepState>>({});
  const stepStatesRef = useRef<Record<string, StepState>>({});

  // Runner state
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'finished' | 'cancelled'>('idle');
  const [currentStepId, setCurrentStepId] = useState<string | null>(null);

  // Prevent concurrent execution / double-starts and allow safe cancellation
  const runIdRef = useRef(0);
  const abortRef = useRef(false);
  const executionLockRef = useRef(false);
  const auditCacheRef = useRef<Map<string, AuditMintResponse>>(new Map());
  // Ref-based guard to prevent concurrent starts (state-based check has race conditions)
  const isRunningRef = useRef(false);

  // Display either the frozen run plan (once started) or the live preview
  const plan = useMemo(() => runPlan ?? computedPlan, [runPlan, computedPlan]);

  useEffect(() => {
    stepStatesRef.current = stepStates;
  }, [stepStates]);

  // Cleanup: abort runner on unmount
  useEffect(() => {
    return () => {
      abortRef.current = true;
      runIdRef.current += 1;
      isRunningRef.current = false;
    };
  }, []);

  // Check if already balanced
  const alreadyBalanced = useMemo(() => {
    return isAlreadyBalanced(plan.currentBalances, plan.targetBalances, MIN_TRANSFER_THRESHOLD);
  }, [plan]);

  // Check if all steps are done or skipped
  const allComplete = useMemo(() => {
    return plan.steps.every((step) => {
      const state = stepStates[step.id];
      // If we haven't started, treat everything as pending
      if (!runPlan) return false;
      return state?.status === 'done' || state?.status === 'skipped' || state?.status === 'failed';
    });
  }, [plan.steps, stepStates, runPlan]);

  // Count completed steps
  const completedCount = useMemo(() => {
    return plan.steps.filter((step) => stepStates[step.id]?.status === 'done').length;
  }, [plan.steps, stepStates]);

  // Check if any step is currently running (must be defined before useEffect that uses it)
  const isExecuting = useMemo(() => {
    return plan.steps.some((step) => {
      const state = stepStates[step.id];
      return (
        state?.status === 'creatingInvoice' ||
        state?.status === 'invoiceReady' ||
        state?.status === 'melting' ||
        state?.status === 'verifying'
      );
    });
  }, [plan.steps, stepStates]);

  const failedCount = useMemo(() => {
    return plan.steps.filter((step) => stepStates[step.id]?.status === 'failed').length;
  }, [plan.steps, stepStates]);

  const terminalCount = useMemo(() => {
    return plan.steps.filter((step) => {
      const s = stepStates[step.id]?.status;
      return s === 'done' || s === 'failed' || s === 'skipped';
    }).length;
  }, [plan.steps, stepStates]);

  const progressPct = useMemo(() => {
    if (!runPlan || plan.steps.length === 0) return 0;
    return Math.max(0, Math.min(1, terminalCount / plan.steps.length));
  }, [runPlan, terminalCount, plan.steps.length]);

  // Update step state helper
  const updateStepState = useCallback((stepId: string, update: Partial<StepState>) => {
    setStepStates((prev) => ({
      ...prev,
      [stepId]: { ...prev[stepId], ...update },
    }));
  }, []);

  const fetchAudit = useCallback(async (mintUrl: string): Promise<AuditMintResponse | null> => {
    const cached = auditCacheRef.current.get(mintUrl);
    if (cached) return cached;

    const res = await auditMint({ mintUrl });
    if (res.isOk()) {
      auditCacheRef.current.set(mintUrl, res.value);
      return res.value;
    }
    return null;
  }, []);

  const computeRouteSuggestion = useCallback(
    async (fromMintUrl: string, toMintUrl: string) => {
      if (!runPlan) return null;

      // Start with mints in the run plan (fast), then optionally widen to a small set of trusted mints.
      // This improves the chance of finding an intermediary without exploding API calls.
      const planMints = runPlan.steps.flatMap((s) => [s.fromMintUrl, s.toMintUrl]);
      const trustedMintUrls = trustedMints.map((m) => m.mintUrl);
      /**
       * Keep this bounded:
       * - Each mint candidate can require an auditor call.
       * - This runs after a failure, so we want a quick suggestion, not a full graph crawl.
       */
      const candidates = Array.from(
        new Set([...planMints, ...trustedMintUrls, fromMintUrl, toMintUrl])
      ).slice(0, 12);

      const audits: AuditMintResponse[] = [];
      for (const url of candidates) {
        const a = await fetchAudit(url);
        if (a) audits.push(a);
      }

      const graph = buildSwapGraph(audits);
      const picked = pickIntermediary({ from: fromMintUrl, to: toMintUrl, graph });
      if (!picked.viaMintUrl) return null;

      const viaMintName = mintInfoMap[picked.viaMintUrl]?.name;
      return { viaMintUrl: picked.viaMintUrl, viaMintName };
    },
    [runPlan, fetchAudit, mintInfoMap, trustedMints]
  );

  // Poll for balance increase with timeout
  const waitForBalanceIncrease = useCallback(
    async (mintUrl: string, _expectedIncrease: number, maxWaitMs: number = 15000) => {
      // Get fresh balances directly from manager to avoid stale closure
      const getBalances = async () => {
        try {
          return await manager.wallet.getBalances();
        } catch {
          return {};
        }
      };

      const initialBalances = await getBalances();
      const startBalance = initialBalances[mintUrl] || 0;
      const startTime = Date.now();
      const pollInterval = 1000; // Check every 1 second

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        const currentBalances = await getBalances();
        const currentBalance = currentBalances[mintUrl] || 0;

        // Allow for some fee variance - consider success if balance increased
        if (currentBalance > startBalance) {
          return true;
        }
      }

      return false;
    },
    [manager]
  );

  // Wait for execution lock with timeout
  const waitForLock = useCallback(async (maxWaitMs: number = 30000): Promise<boolean> => {
    const startTime = Date.now();
    const pollInterval = 100;

    while (executionLockRef.current) {
      if (Date.now() - startTime > maxWaitMs) {
        console.warn('Timed out waiting for execution lock');
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
    return true;
  }, []);

  // Execute a single step with fee-aware logic (returns true if done, false if failed)
  const executeStep = useCallback(
    async (step: TransferStep, runId: number): Promise<boolean> => {
      if (abortRef.current || runIdRef.current !== runId) return false;

      // Prevent concurrent melt operations
      // Coco operations are stateful (proof selection, inflight tracking, etc). Running melts in parallel
      // can lead to "melt already in progress" or confusing intermediate states.
      // Wait for any existing operation to complete instead of returning early
      const gotLock = await waitForLock();
      if (!gotLock) {
        console.warn('Failed to acquire execution lock for step:', step.id);
        return false;
      }
      if (abortRef.current || runIdRef.current !== runId) return false;
      executionLockRef.current = true;

      const { id, fromMintUrl, toMintUrl, amount: originalAmount } = step;

      try {
        // Get fresh balances to check source mint
        const currentBalances = await manager.wallet.getBalances();
        const sourceBalance = currentBalances[fromMintUrl] || 0;

        // Step 1: Create invoice on receiver mint
        updateStepState(id, { status: 'creatingInvoice', errorMessage: undefined });

        let transferAmount = originalAmount;
        let invoice: string;
        let preparedMeltOp: { id: string } | null = null;

        // Create initial invoice
        let mintQuote = await requestLightningInvoice(toMintUrl, transferAmount);
        invoice = mintQuote.request;

        // Step 2: Prepare melt to get exact fees (v3 API)
        // This provides fee transparency and an operation ID for crash recovery.
        updateStepState(id, { status: 'invoiceReady', invoice });

        const prepareForInvoice = async (invoiceToPay: string) => {
          const prepared = await manager.quotes.prepareMeltBolt11(fromMintUrl, invoiceToPay);
          updateStepState(id, { operationId: prepared.id });
          return prepared as unknown as {
            id: string;
            amount?: number | string;
            fee_reserve?: number | string;
            swap_fee?: number | string;
          };
        };

        let preparedForFees = await prepareForInvoice(invoice);
        preparedMeltOp = preparedForFees;

        const invoiceAmount = Number(preparedForFees.amount ?? transferAmount);
        const feeReserve = Number(preparedForFees.fee_reserve ?? 0);
        const swapFee = Number(preparedForFees.swap_fee ?? 0);
        const totalRequired = invoiceAmount + feeReserve + swapFee;

        // Check if we have enough balance
        if (totalRequired > sourceBalance) {
          // Need to adjust - calculate max we can actually transfer
          const maxTransferable = sourceBalance - feeReserve - swapFee - MIN_FEE_RESERVE;

          if (maxTransferable <= MIN_TRANSFER_THRESHOLD) {
            throw new Error(
              `Insufficient balance: need ${totalRequired} sats but only have ${sourceBalance} sats`
            );
          }

          // Recreate invoice with adjusted amount
          console.log(
            `Adjusting transfer: ${transferAmount} -> ${maxTransferable} (balance: ${sourceBalance}, fee_reserve: ${feeReserve}, swap_fee: ${swapFee})`
          );
          transferAmount = maxTransferable;
          mintQuote = await requestLightningInvoice(toMintUrl, transferAmount);
          invoice = mintQuote.request;

          updateStepState(id, { status: 'invoiceReady', invoice });

          // Re-prepare for the new invoice amount to get updated fees + operation id.
          preparedForFees = await prepareForInvoice(invoice);
          preparedMeltOp = preparedForFees;
        }

        // Step 3: Melt from sender mint by paying the invoice
        // Use the v3 two-step flow: prepareMeltBolt11 + executeMelt
        updateStepState(id, { status: 'melting' });

        const executeMeltWithRetry = async () => {
          try {
            if (!preparedMeltOp) {
              preparedMeltOp = await prepareForInvoice(invoice);
            }

            const result = (await manager.quotes.executeMelt(preparedMeltOp.id)) as unknown as
              | { state?: string; id?: string }
              | undefined;

            if (result?.state === 'pending') {
              // Pending payments need explicit handling to avoid double-paying on retries.
              // We poll briefly; if it remains pending, we fail the step with a non-retriable message.
              const opId = result.id ?? preparedMeltOp.id;
              const maxWaitMs = 20000;
              const pollIntervalMs = 2000;
              const start = Date.now();

              while (Date.now() - start < maxWaitMs) {
                const decision = await manager.quotes.checkPendingMelt(opId);
                if (decision === 'finalize') return;
                if (decision === 'rollback') {
                  throw new Error('Melt payment rolled back by mint');
                }
                await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
              }

              throw new Error(
                'Payment pending. Please wait and reopen later; the app will recover this operation automatically.'
              );
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('Melt operation already in progress')) {
              // Coco internally serializes melts; give it a moment and retry once.
              await new Promise((resolve) => setTimeout(resolve, 900));
              preparedMeltOp = await prepareForInvoice(invoice);
              await manager.quotes.executeMelt(preparedMeltOp.id);
              return;
            }
            throw err;
          }
        };

        await executeMeltWithRetry();

        // Step 4: Verify - wait for balance to increase on receiving mint
        // The MintQuoteProcessor runs every 5 seconds to claim paid quotes
        updateStepState(id, { status: 'verifying' });

        // Poll for up to 15 seconds for the balance to update
        const balanceUpdated = await waitForBalanceIncrease(toMintUrl, transferAmount, 15000);

        if (!balanceUpdated) {
          /**
           * Verification is best-effort:
           * - receiving mint may not have redeemed the quote yet (processor runs periodically)
           * - network latency can exceed our wait window
           *
           * We still mark the step done if the melt succeeded; eventual consistency will catch up.
           */
          console.warn('Balance did not increase within timeout, but melt succeeded');
        }

        // Mark as done
        updateStepState(id, { status: 'done' });

        // Add a small delay between steps to avoid overwhelming the mints
        await new Promise((resolve) => setTimeout(resolve, 500));
        return true;
      } catch (error) {
        let errorMessage = error instanceof Error ? error.message : 'Transfer failed';

        // Parse and improve error messages for common Lightning/mint errors
        if (errorMessage.includes('lnd is not ready') || errorMessage.includes('not ready for')) {
          errorMessage =
            'Mint Lightning node is not ready. The mint may be starting up or syncing. Try again in a few minutes.';
        } else if (
          errorMessage.includes('FAILURE_REASON_NO_ROUTE') ||
          errorMessage.includes('no_route')
        ) {
          errorMessage =
            'No Lightning route found between mints. Try routing through an intermediary.';
        } else if (errorMessage.includes('FAILURE_REASON_TIMEOUT')) {
          errorMessage = 'Lightning payment timed out. The mint may be slow to respond.';
        } else if (errorMessage.includes('invoice expired') || errorMessage.includes('EXPIRED')) {
          errorMessage = 'Invoice expired before payment could complete. Please retry.';
        } else if (errorMessage.includes('insufficient')) {
          errorMessage = 'Insufficient balance or liquidity for this transfer.';
        }

        updateStepState(id, { status: 'failed', errorMessage });

        // If this is a no_route failure, compute a route suggestion asynchronously and show progress.
        const rawError = error instanceof Error ? error.message : String(error);
        if (rawError.includes('no_route') || rawError.includes('FAILURE_REASON_NO_ROUTE')) {
          updateStepState(id, { routeSuggestion: { status: 'searching' } });
          (async () => {
            const suggestion = await computeRouteSuggestion(fromMintUrl, toMintUrl);
            if (!suggestion) {
              updateStepState(id, { routeSuggestion: { status: 'none' } });
              return;
            }
            updateStepState(id, { routeSuggestion: { status: 'found', ...suggestion } });
          })();
        }
        return false;
      } finally {
        // Always release the lock
        executionLockRef.current = false;
      }
    },
    [
      requestLightningInvoice,
      updateStepState,
      waitForBalanceIncrease,
      waitForLock,
      manager,
      computeRouteSuggestion,
    ]
  );

  const runStepsSequentially = useCallback(
    async (steps: TransferStep[], runId: number) => {
      try {
        for (const step of steps) {
          if (abortRef.current || runIdRef.current !== runId) return;

          const current = stepStatesRef.current[step.id]?.status;
          if (current === 'done' || current === 'skipped') continue;

          setCurrentStepId(step.id);
          // Execute; if it fails, we keep going to the next step (error tolerant)
          await executeStep(step, runId);
        }

        if (abortRef.current || runIdRef.current !== runId) return;
        setCurrentStepId(null);
        setRunStatus('finished');
      } finally {
        // Always reset the running ref when done
        isRunningRef.current = false;
      }
    },
    [executeStep]
  );

  // Handle starting execution (Start once)
  const handleStart = useCallback(() => {
    // Use ref-based guard to prevent race conditions (state check is async)
    if (isRunningRef.current) return;
    if (runStatus === 'running') return;

    // Immediately set ref to prevent concurrent starts
    isRunningRef.current = true;
    abortRef.current = false;
    const runId = (runIdRef.current += 1);

    // Freeze the plan snapshot
    const snapshot = computedPlan;
    setRunPlan(snapshot);

    // Initialize states for frozen steps
    const initial: Record<string, StepState> = {};
    for (const step of snapshot.steps) {
      initial[step.id] = { status: 'pending' };
    }
    setStepStates(initial);
    setRunStatus('running');
    setCurrentStepId(null);

    // Kick off the runner (do not await; keep UI responsive)
    // Use the snapshot steps (stable), not any live recomputed list.
    runStepsSequentially(snapshot.steps, runId);
  }, [computedPlan, runStatus, runStepsSequentially]);

  // Handle retry for a failed step
  const handleRetry = useCallback(
    async (step: TransferStep) => {
      // Use ref-based guard to prevent race conditions
      if (isRunningRef.current) return;
      if (runStatus === 'running') return;

      isRunningRef.current = true;
      abortRef.current = false;
      const runId = (runIdRef.current += 1);
      setRunStatus('running');
      setCurrentStepId(step.id);
      updateStepState(step.id, {
        status: 'pending',
        errorMessage: undefined,
        routeSuggestion: undefined,
      });
      try {
        await executeStep(step, runId);
      } finally {
        isRunningRef.current = false;
      }
      setCurrentStepId(null);
      setRunStatus('finished');
    },
    [executeStep, updateStepState, runStatus]
  );

  // Handle skip for a failed step
  const handleSkip = useCallback(
    (step: TransferStep) => {
      if (runStatus === 'running') return;
      updateStepState(step.id, { status: 'skipped' });
    },
    [updateStepState, runStatus]
  );

  // Handle done - go back
  const handleDone = useCallback(() => {
    router.back();
  }, []);

  // Check if there's a failed step
  const hasFailedStep = useMemo(() => {
    return plan.steps.some((step) => stepStates[step.id]?.status === 'failed');
  }, [plan.steps, stepStates]);

  const handleRetryFailed = useCallback(async () => {
    if (!runPlan) return;
    // Use ref-based guard to prevent race conditions
    if (isRunningRef.current) return;
    if (runStatus === 'running') return;

    isRunningRef.current = true;
    abortRef.current = false;
    const runId = (runIdRef.current += 1);
    setRunStatus('running');

    // Reset only failed steps to pending
    setStepStates((prev) => {
      const next = { ...prev };
      for (const step of runPlan.steps) {
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
    });

    await runStepsSequentially(runPlan.steps, runId);
  }, [runPlan, runStatus, runStepsSequentially]);

  const handleRouteThrough = useCallback(
    async (step: TransferStep) => {
      if (!runPlan) return;
      // Use ref-based guard to prevent race conditions
      if (isRunningRef.current) return;
      if (runStatus === 'running') return;

      const suggestion = stepStatesRef.current[step.id]?.routeSuggestion;
      if (!suggestion || suggestion.status !== 'found' || !suggestion.viaMintUrl) return;

      isRunningRef.current = true;
      const via = suggestion.viaMintUrl;
      const afterId = step.id;

      const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const rerouteStep1: TransferStep = {
        ...step,
        id: `reroute-${afterId}-a-${uniqueSuffix}`,
        toMintUrl: via,
      };
      const rerouteStep2: TransferStep = {
        ...step,
        id: `reroute-${afterId}-b-${uniqueSuffix}`,
        fromMintUrl: via,
      };

      const insertAfter = (arr: TransferStep[], id: string, toInsert: TransferStep[]) => {
        const idx = arr.findIndex((s) => s.id === id);
        if (idx === -1) return arr;
        return [...arr.slice(0, idx + 1), ...toInsert, ...arr.slice(idx + 1)];
      };

      const nextSteps = insertAfter(runPlan.steps, afterId, [rerouteStep1, rerouteStep2]);
      setRunPlan((prev) => (prev ? { ...prev, steps: nextSteps } : prev));

      /**
       * We keep the original step visible (marked skipped) so the user can see what happened.
       * New A→via and via→B steps are inserted immediately after it.
       *
       * Important: update `stepStatesRef` immediately so the runner (which reads the ref) sees the new steps.
       */
      const nextStates = { ...stepStatesRef.current };
      nextStates[afterId] = { ...nextStates[afterId], status: 'skipped' };
      nextStates[rerouteStep1.id] = { status: 'pending' };
      nextStates[rerouteStep2.id] = { status: 'pending' };
      stepStatesRef.current = nextStates;
      setStepStates(nextStates);

      // Immediately execute pending steps (Start once behavior)
      abortRef.current = false;
      const runId = (runIdRef.current += 1);
      setRunStatus('running');
      setCurrentStepId(null);
      await runStepsSequentially(nextSteps, runId);
    },
    [runPlan, runStatus, runStepsSequentially]
  );

  const handleCancelRun = useCallback(() => {
    // Best-effort abort: we can't cancel an in-flight melt, but we can stop scheduling new steps.
    abortRef.current = true;
    runIdRef.current += 1;
    isRunningRef.current = false;
    setRunStatus('cancelled');
    setCurrentStepId(null);
  }, []);

  // Bottom buttons
  const bottomButtons = useMemo(() => {
    if (alreadyBalanced || plan.steps.length === 0) {
      return (
        <BottomButtons>
          <ButtonHandler
            buttons={[
              {
                text: 'Done',
                variant: 'primary' as const,
                onPress: async () => handleDone(),
              },
            ]}
          />
        </BottomButtons>
      );
    }

    if (runStatus === 'finished' || allComplete) {
      return (
        <BottomButtons>
          <ButtonHandler
            buttons={[
              {
                text: 'Done',
                variant: 'primary' as const,
                onPress: async () => handleDone(),
              },
              ...(hasFailedStep
                ? [
                    {
                      text: 'Retry failed',
                      variant: 'secondary' as const,
                      onPress: async () => handleRetryFailed(),
                    },
                  ]
                : []),
            ]}
          />
        </BottomButtons>
      );
    }

    // If not started yet, show Start button (Start once)
    if (runStatus === 'idle') {
      return (
        <BottomButtons>
          <ButtonHandler
            buttons={[
              {
                text: 'Cancel',
                variant: 'secondary' as const,
                onPress: async () => handleDone(),
              },
              {
                text: 'Start Rebalancing',
                variant: 'primary' as const,
                onPress: async () => handleStart(),
              },
            ]}
          />
        </BottomButtons>
      );
    }

    // Execution in progress (or cancelled but still on screen)
    return (
      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: runStatus === 'cancelled' ? 'Done' : 'Stop',
              variant: 'secondary' as const,
              onPress: async () => {
                if (runStatus === 'cancelled') return handleDone();
                if (runStatus === 'running') return handleCancelRun();
                return handleDone();
              },
              disabled: isExecuting && runStatus === 'running',
            },
          ]}
        />
      </BottomButtons>
    );
  }, [
    alreadyBalanced,
    plan.steps,
    allComplete,
    hasFailedStep,
    isExecuting,
    runStatus,
    handleDone,
    handleStart,
    handleRetryFailed,
    handleCancelRun,
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: primaryColor950 }}>
      <Stack.Screen
        options={{
          title: 'Rebalance Plan',
          // Explicitly clear any previously-set headerRight (React Navigation sometimes keeps prior options while hot-reloading).
          headerRight: () => null,
        }}
      />

      <ModalLayoutWrapper bottomContent={bottomButtons} contentPadding={0}>
        {/* Summary header */}
        <View style={[styles.summaryContainer, { backgroundColor: primaryColor800 }]}>
          <VStack gap={8}>
            {runPlan && (
              <View style={[styles.progressTrack, { backgroundColor: primaryColor700 }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${progressPct * 100}%`,
                      backgroundColor: failedCount > 0 ? '#ef4444' : greenColor,
                    },
                  ]}
                />
              </View>
            )}
            <HStack justify="space-between" align="center">
              <Text size={14} style={{ color: primaryColor300 }}>
                Total to move
              </Text>
              <AmountFormatter
                amount={plan.totalAmount}
                unit={unit}
                size={18}
                weight="heavy"
                color={primaryColor0}
              />
            </HStack>
            <HStack justify="space-between" align="center">
              <Text size={14} style={{ color: primaryColor300 }}>
                Steps
              </Text>
              <Text bold overpass size={18} style={{ color: primaryColor0 }}>
                {completedCount}/{plan.steps.length}
              </Text>
            </HStack>
            {runPlan && (
              <HStack justify="space-between" align="center">
                <Text size={14} style={{ color: primaryColor300 }}>
                  Errors
                </Text>
                <Text
                  bold
                  overpass
                  size={18}
                  style={{ color: failedCount > 0 ? '#ef4444' : primaryColor0 }}>
                  {failedCount}
                </Text>
              </HStack>
            )}
            <Text size={11} style={{ color: primaryColor400 }}>
              Transfers under {MIN_TRANSFER_THRESHOLD} sats are ignored
            </Text>
          </VStack>
        </View>

        {/* Already balanced message */}
        {alreadyBalanced && (
          <View style={styles.emptyContainer}>
            <VStack gap={12} align="center">
              <Icon name="mdi:check-circle" size={48} color={greenColor} />
              <Text size={16} style={{ color: primaryColor0, textAlign: 'center' }}>
                Already balanced!
              </Text>
              <Text size={14} style={{ color: primaryColor300, textAlign: 'center' }}>
                Your current balances match the desired distribution.
              </Text>
            </VStack>
          </View>
        )}

        {/* No steps needed */}
        {!alreadyBalanced && plan.steps.length === 0 && (
          <View style={styles.emptyContainer}>
            <VStack gap={12} align="center">
              <Icon name="mdi:check-circle" size={48} color={greenColor} />
              <Text size={16} style={{ color: primaryColor0, textAlign: 'center' }}>
                No transfers needed
              </Text>
              <Text size={14} style={{ color: primaryColor300, textAlign: 'center' }}>
                All differences are below the {MIN_TRANSFER_THRESHOLD} sat threshold.
              </Text>
            </VStack>
          </View>
        )}

        {/* Steps list */}
        {plan.steps.length > 0 && (
          <VStack gap={0} style={{ paddingTop: 8 }}>
            {plan.steps.map((step, index) => {
              const state = runPlan
                ? stepStates[step.id] || { status: 'pending' }
                : { status: 'pending' as StepStatus };
              return (
                <RebalanceStepRow
                  key={step.id}
                  id={step.id}
                  fromMintUrl={step.fromMintUrl}
                  fromMintInfo={mintInfoMap[step.fromMintUrl]}
                  toMintUrl={step.toMintUrl}
                  toMintInfo={mintInfoMap[step.toMintUrl]}
                  amount={step.amount}
                  unit={unit}
                  status={state.status}
                  errorMessage={state.errorMessage}
                  routeSuggestion={state.routeSuggestion}
                  onRouteThrough={
                    runStatus !== 'running' ? () => handleRouteThrough(step) : undefined
                  }
                  onRetry={
                    runStatus !== 'running' &&
                    state.status === 'failed' &&
                    !String(state.errorMessage ?? '').startsWith('Payment pending.')
                      ? () => handleRetry(step)
                      : undefined
                  }
                  onSkip={runStatus !== 'running' ? () => handleSkip(step) : undefined}
                  stepNumber={index + 1}
                  isCurrent={runPlan ? currentStepId === step.id : false}
                />
              );
            })}
          </VStack>
        )}

        {/* Run finished message */}
        {runStatus === 'finished' && plan.steps.length > 0 && (
          <View style={styles.completeContainer}>
            <VStack gap={8} align="center">
              {failedCount > 0 ? (
                <>
                  <Icon name="mdi:alert-circle" size={32} color={'#ef4444'} />
                  <Text size={14} style={{ color: '#ef4444', textAlign: 'center' }}>
                    Finished with errors
                  </Text>
                  <Text size={12} style={{ color: primaryColor300, textAlign: 'center' }}>
                    Some transfers failed. You can retry the failed ones.
                  </Text>
                </>
              ) : (
                <>
                  <Icon name="mdi:check-circle" size={32} color={greenColor} />
                  <Text size={14} style={{ color: greenColor, textAlign: 'center' }}>
                    Rebalance complete!
                  </Text>
                </>
              )}
            </VStack>
          </View>
        )}
      </ModalLayoutWrapper>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryContainer: {
    padding: 16,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 16,
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 999,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  completeContainer: {
    padding: 24,
    alignItems: 'center',
  },
});

export default withSheetProvider(RebalancePlanScreen);
