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
import { ScrollView, StyleSheet } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/hooks/useThemeColor';
import { Text } from 'components/ui/Text';
import { View } from 'components/ui/View/View';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { ModalLayoutWrapper } from 'app/debugModal';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { useMints, useBalanceContext, useManager } from 'coco-cashu-react';
import { useMintManagement } from '@/hooks/coco/useMintManagement';
import { useLightningOperations } from '@/hooks/coco/useLightningOperations';
import { MIN_FEE_RESERVE } from 'components/blocks/rebalance';
import { useMintDistributionStore } from 'stores/mintDistributionStore';
import { useSwapTransactionsStore, type SwapLegLocalStatus } from 'stores/swapTransactionsStore';
import {
  RebalanceStepRow,
  computeRebalancePlan,
  isAlreadyBalanced,
  buildSwapGraph,
  pickIntermediaryPath,
  addLocalHistoryEdges,
  getLocalCandidatesForDestination,
  type TransferStep,
  type RebalancePlan,
  type StepStatus,
} from 'components/blocks/rebalance';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { BlurCardFrame } from 'components/ui/BlurCardFrame';
import { useSettingsStore } from 'stores/settingsStore';
import { CocoManager } from 'helper/coco/manager';
import Icon from 'assets/icons';
import { auditMint, type AuditMintResponse } from 'helper/apiClient';

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

interface StepState {
  status: StepStatus;
  errorMessage?: string;
  invoice?: string;
  operationId?: string;
  routeSuggestion?: {
    status: 'searching' | 'found' | 'none';
    /** Full path including source and destination: [A, via1, ..., B]. */
    path?: string[];
    /** Human-readable names for each mint in the path (parallel array). */
    pathNames?: string[];
  };
  // Auto-routing state
  routingDetail?: string;
}

function RebalancePlanScreen() {
  const [foreground, surfaceTertiary, surfaceSecondary, background] = useThemeColor(['foreground', 'surface-tertiary', 'surface-secondary', 'background'] as const);
  const [danger, green400] = useThemeColor(['danger', 'green-400'] as const);
  const primaryColor0 = foreground;
  const primaryColor300 = opacity(foreground, 0.5);
  const primaryColor400 = opacity(foreground, 0.4);
  const primaryColor700 = surfaceTertiary;
  const primaryColor800 = surfaceSecondary;
  const primaryColor950 = background;
  const greenColor = green400;

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

  // Settings
  const middlemanRouting = useSettingsStore((state) => state.middlemanRouting);
  const minTransferThreshold = useSettingsStore((state) => state.minTransferThreshold);

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
    return computeRebalancePlan(mintBalances, distribution, minTransferThreshold);
  }, [mintUrls, liveBalances, distribution, minTransferThreshold]);

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

  // Swap grouping (store only; Coco remains source of HistoryEntry truth)
  const swapGroupIdRef = useRef<string | null>(null);
  const swapLegIdByStepIdRef = useRef<Record<string, string>>({});

  // Debug error log – appended to on every step start / error / completion
  const [debugLog, setDebugLog] = useState<Record<string, unknown>[]>([]);
  const appendDebug = useCallback((entry: Record<string, unknown>) => {
    const stamped = { ...entry, _ts: new Date().toISOString() };
    console.log('[REBALANCE]', JSON.stringify(stamped));
    setDebugLog((prev) => [...prev, stamped]);
  }, []);

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
    return isAlreadyBalanced(plan.currentBalances, plan.targetBalances, minTransferThreshold);
  }, [plan, minTransferThreshold]);

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
        state?.status === 'verifying' ||
        state?.status === 'routing'
      );
    });
  }, [plan.steps, stepStates]);

  const failedCount = useMemo(() => {
    return plan.steps.filter((step) => stepStates[step.id]?.status === 'failed').length;
  }, [plan.steps, stepStates]);

  const skippedCount = useMemo(() => {
    return plan.steps.filter((step) => stepStates[step.id]?.status === 'skipped').length;
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
      const trustedUrls = trustedMints.map((m) => m.mintUrl);

      // Also include mints from local swap history that have reached the destination
      const allGroups = Object.values(useSwapTransactionsStore.getState().groups);
      const localCandidateMints = getLocalCandidatesForDestination(
        allGroups,
        toMintUrl,
        fromMintUrl
      );

      /**
       * Keep this bounded:
       * - Each mint candidate can require an auditor call.
       * - This runs after a failure, so we want a quick suggestion, not a full graph crawl.
       */
      const candidates = Array.from(
        new Set([...planMints, ...trustedUrls, ...localCandidateMints, fromMintUrl, toMintUrl])
      ).slice(0, 12);

      const audits: AuditMintResponse[] = [];
      for (const url of candidates) {
        const a = await fetchAudit(url);
        if (a) audits.push(a);
      }

      const graph = buildSwapGraph(audits);

      // Merge our own local swap history into the graph so personally observed
      // routes (e.g. "minibits → sovran worked last week") supplement auditor data
      addLocalHistoryEdges(graph, allGroups);

      const trustedMintUrls = new Set(trustedUrls);
      const result = pickIntermediaryPath({
        from: fromMintUrl,
        to: toMintUrl,
        graph,
        settings: middlemanRouting,
        trustedMintUrls,
      });
      if (!result.path) return null;

      const pathNames = result.path.map((url) => mintInfoMap[url]?.name || url);
      return { path: result.path, pathNames };
    },
    [runPlan, fetchAudit, mintInfoMap, trustedMints, middlemanRouting]
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

      appendDebug({
        event: 'step_start',
        stepId: id,
        fromMintUrl,
        toMintUrl,
        amount: originalAmount,
        chainId: step.chainId,
        chainHopIndex: step.chainHopIndex,
      });

      const groupId = swapGroupIdRef.current;
      const ensureLegId = () => {
        if (!groupId) return null;
        const existing = swapLegIdByStepIdRef.current[id];
        if (existing) return existing;

        const legId = useSwapTransactionsStore.getState().addLeg(groupId, {
          fromMintUrl,
          toMintUrl,
          amount: originalAmount,
          ...(step.chainId && {
            chainId: step.chainId,
            chainPath: step.chainPath,
            chainHopIndex: step.chainHopIndex,
          }),
        });
        swapLegIdByStepIdRef.current[id] = legId;
        useSwapTransactionsStore
          .getState()
          .setLegStatus(groupId, legId, { localStatus: 'pending' });
        return legId;
      };

      const setLegLocalStatus = (localStatus: SwapLegLocalStatus, errorMessage?: string) => {
        const legId = ensureLegId();
        if (!groupId || !legId) return;
        useSwapTransactionsStore
          .getState()
          .setLegStatus(groupId, legId, { localStatus, errorMessage });
      };

      try {
        // Get fresh balances to check source mint
        const currentBalances = await manager.wallet.getBalances();
        const sourceBalance = currentBalances[fromMintUrl] || 0;

        appendDebug({
          event: 'balances_fetched',
          stepId: id,
          sourceBalance,
          allBalances: currentBalances,
        });

        // ── Dynamic fee headroom ──
        // Compute actual input fees from the source mint's proof set instead
        // of using a static constant.  When proofs are fragmented and the mint
        // charges per-proof input fees (input_fee_ppk), a static headroom of
        // ~5 sats can be far too small, causing "Not enough proofs to send".
        const STATIC_FEE_HEADROOM = MIN_FEE_RESERVE + 2; // fallback: 5 sats
        let feeHeadroom = STATIC_FEE_HEADROOM;
        let worstCaseInputFee = 0;
        try {
          const proofs = await manager.proofService.getReadyProofs(fromMintUrl);
          const wallet = await manager.walletService.getWallet(fromMintUrl);
          worstCaseInputFee = wallet.getFeesForProofs(proofs as any);
          // fee_reserve (conservative floor) + worst-case input fee (all proofs selected)
          feeHeadroom = Math.max(STATIC_FEE_HEADROOM, MIN_FEE_RESERVE + worstCaseInputFee);
          appendDebug({
            event: 'fee_headroom_computed',
            stepId: id,
            proofCount: proofs.length,
            inputFee: worstCaseInputFee,
            feeHeadroom,
          });
        } catch {
          // Fallback to static headroom if proof query fails
        }

        // ── Early skip: source balance too low ──
        // This commonly happens when a prior step's middleman routing already
        // swept the funds from this mint to the destination.  Rather than
        // reporting an error, we skip the step gracefully.
        if (sourceBalance < minTransferThreshold + feeHeadroom) {
          appendDebug({
            event: 'step_skipped_low_balance',
            stepId: id,
            sourceBalance,
            minRequired: minTransferThreshold + feeHeadroom,
          });
          updateStepState(id, { status: 'skipped' });
          return true; // not a failure — funds already transferred
        }

        // Step 1: Create invoice on receiver mint
        updateStepState(id, { status: 'creatingInvoice', errorMessage: undefined });
        setLegLocalStatus('creatingInvoice');

        let transferAmount = originalAmount;
        let finalAutoRouteStepId: string | null = null;
        let invoice: string;
        let preparedMeltOp: { id: string } | null = null;

        // ── Fee headroom ──
        // prepareMeltBolt11 internally selects proofs for (invoiceAmount + fee_reserve).
        // If the planned transfer is close to the full balance, that sum exceeds what's
        // available and throws "Not enough proofs to send" before we can adjust.
        // Pre-cap the amount to leave room for fees (fee_reserve + input fees).
        if (transferAmount + feeHeadroom > sourceBalance) {
          const capped = sourceBalance - feeHeadroom;
          if (capped < minTransferThreshold) {
            throw new Error(
              `Insufficient balance after fee headroom: ${sourceBalance} sats, need at least ${minTransferThreshold + feeHeadroom}`
            );
          }
          appendDebug({
            event: 'amount_capped',
            stepId: id,
            original: transferAmount,
            capped,
            sourceBalance,
            feeHeadroom,
          });
          transferAmount = capped;
        }

        // Helper: create invoice + tag the leg
        const createInvoiceForAmount = async (amt: number) => {
          const mq = await requestLightningInvoice(toMintUrl, amt);
          const legId = ensureLegId();
          const mqId = (mq as any)?.quote ?? (mq as any)?.quoteId ?? (mq as any)?.id;
          if (groupId && legId && mqId) {
            useSwapTransactionsStore.getState().tagMintQuote(groupId, legId, String(mqId));
          }
          return mq;
        };

        let mintQuote = await createInvoiceForAmount(transferAmount);
        invoice = mintQuote.request;

        // ── Probe melt quote for actual fee_reserve ──
        // The mint's fee_reserve varies wildly (e.g. 2 vs 10 sats) and we can't
        // know it without asking.  Probe via the cashu-ts wallet directly (pure
        // HTTP, no persistence/events) to discover the real fee_reserve, then
        // re-cap the transfer amount if needed — avoiding blind retry loops.
        try {
          const probeWallet = await manager.walletService.getWallet(fromMintUrl);
          const probeQuote = await (probeWallet as any).createMeltQuoteBolt11(invoice);
          const actualFeeReserve = Number(probeQuote.fee_reserve ?? 0);

          if (actualFeeReserve > 0) {
            const probedHeadroom = actualFeeReserve + worstCaseInputFee;
            appendDebug({
              event: 'melt_probe_result',
              stepId: id,
              actualFeeReserve,
              worstCaseInputFee,
              probedHeadroom,
              previousHeadroom: feeHeadroom,
            });
            feeHeadroom = Math.max(feeHeadroom, probedHeadroom);

            // Re-cap transfer amount if the probed headroom reveals we're over budget
            if (transferAmount + feeHeadroom > sourceBalance) {
              const capped = sourceBalance - feeHeadroom;
              if (capped >= minTransferThreshold) {
                appendDebug({
                  event: 'amount_recapped_after_probe',
                  stepId: id,
                  original: transferAmount,
                  capped,
                  sourceBalance,
                  feeHeadroom,
                });
                transferAmount = capped;
                mintQuote = await createInvoiceForAmount(transferAmount);
                invoice = mintQuote.request;
              }
            }
          }
        } catch {
          // Probe failed — proceed with existing headroom estimate; the retry
          // loop below will handle any "Not enough proofs" errors.
        }

        // Step 2: Prepare melt to get exact fees (v3 API)
        // This provides fee transparency and an operation ID for crash recovery.
        updateStepState(id, { status: 'invoiceReady', invoice });
        setLegLocalStatus('invoiceReady');

        const prepareForInvoice = async (invoiceToPay: string) => {
          const prepared = await manager.quotes.prepareMeltBolt11(fromMintUrl, invoiceToPay);
          updateStepState(id, { operationId: prepared.id });
          {
            const legId = ensureLegId();
            const quoteId =
              (prepared as any)?.quoteId ?? (prepared as any)?.quote ?? (prepared as any)?.id;
            if (groupId && legId && quoteId) {
              useSwapTransactionsStore.getState().tagMelt(groupId, legId, {
                quoteId: String(quoteId),
                operationId: String(prepared.id),
              });
            }
          }
          return prepared as unknown as {
            id: string;
            amount?: number | string;
            fee_reserve?: number | string;
            swap_fee?: number | string;
          };
        };

        // ── Prepare with automatic retry on "Not enough proofs" ──
        // Even with the dynamic fee headroom, fee estimates can be slightly off
        // (e.g. swap changes proof set).  Retry with larger reductions per attempt.
        const MAX_PREPARE_RETRIES = 5;
        const RETRY_REDUCE_SATS = 2;
        let preparedForFees: Awaited<ReturnType<typeof prepareForInvoice>> | null = null;

        for (let attempt = 0; attempt <= MAX_PREPARE_RETRIES; attempt++) {
          try {
            preparedForFees = await prepareForInvoice(invoice);
            break; // success
          } catch (prepErr) {
            const msg = prepErr instanceof Error ? prepErr.message : String(prepErr);
            const isProofErr = msg.includes('Not enough proofs');

            if (isProofErr && attempt < MAX_PREPARE_RETRIES) {
              transferAmount -= RETRY_REDUCE_SATS;
              if (transferAmount < minTransferThreshold) {
                throw prepErr; // can't reduce further
              }
              appendDebug({
                event: 'prepare_retry',
                stepId: id,
                attempt: attempt + 1,
                reducedAmount: transferAmount,
                reason: msg,
              });
              mintQuote = await createInvoiceForAmount(transferAmount);
              invoice = mintQuote.request;
              updateStepState(id, { status: 'invoiceReady', invoice });
              continue;
            }
            throw prepErr; // non-proof error or retries exhausted
          }
        }

        if (!preparedForFees) {
          throw new Error('Failed to prepare melt after retries');
        }
        preparedMeltOp = preparedForFees;

        const invoiceAmount = Number(preparedForFees.amount ?? transferAmount);
        const feeReserve = Number(preparedForFees.fee_reserve ?? 0);
        const swapFee = Number(preparedForFees.swap_fee ?? 0);
        const totalRequired = invoiceAmount + feeReserve + swapFee;

        appendDebug({
          event: 'melt_prepared',
          stepId: id,
          operationId: preparedForFees.id,
          invoiceAmount,
          feeReserve,
          swapFee,
          totalRequired,
          sourceBalance,
          preparedRaw: preparedForFees,
        });

        // Step 3: Melt from sender mint by paying the invoice
        // Use the v3 two-step flow: prepareMeltBolt11 + executeMelt
        updateStepState(id, { status: 'melting' });
        setLegLocalStatus('melting');

        const executeMeltWithRetry = async () => {
          // Retry loop: handles "not enough inputs" from the mint at execute time.
          // The mint's actual fee requirement can be higher than what prepare estimated,
          // so we reduce the amount and re-prepare when this happens.
          const MAX_EXECUTE_RETRIES = 2;
          for (let execAttempt = 0; execAttempt <= MAX_EXECUTE_RETRIES; execAttempt++) {
            try {
              if (!preparedMeltOp) {
                preparedMeltOp = await prepareForInvoice(invoice);
              }

              const result = (await manager.quotes.executeMelt(preparedMeltOp.id)) as unknown as
                | { state?: string; id?: string }
                | undefined;

              if (result?.state === 'pending') {
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

              return; // success
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);

              if (msg.includes('Melt operation already in progress')) {
                await new Promise((resolve) => setTimeout(resolve, 900));
                preparedMeltOp = await prepareForInvoice(invoice);
                await manager.quotes.executeMelt(preparedMeltOp.id);
                return;
              }

              // Mint rejected inputs as insufficient — reduce amount and retry
              // e.g. "not enough inputs provided for melt. Provided: 13, needed: 14"
              const isInputShortfall =
                msg.includes('not enough inputs') || msg.includes('inputs provided for melt');

              if (isInputShortfall && execAttempt < MAX_EXECUTE_RETRIES) {
                transferAmount -= RETRY_REDUCE_SATS;
                if (transferAmount < minTransferThreshold) throw err;

                appendDebug({
                  event: 'execute_input_retry',
                  stepId: id,
                  attempt: execAttempt + 1,
                  reducedAmount: transferAmount,
                  reason: msg,
                });

                // Restore proofs from the failed attempt, then start fresh
                await CocoManager.restoreInflightProofsForMint(fromMintUrl);
                mintQuote = await createInvoiceForAmount(transferAmount);
                invoice = mintQuote.request;
                preparedMeltOp = null;
                updateStepState(id, { status: 'invoiceReady', invoice });
                continue;
              }

              throw err;
            }
          }
        };

        // ── Execute melt — with automatic middleman rerouting on no_route ──
        let meltSucceeded = false;
        try {
          await executeMeltWithRetry();
          meltSucceeded = true;
        } catch (meltErr) {
          const meltMsg = meltErr instanceof Error ? meltErr.message : String(meltErr);
          const lower = meltMsg.toLowerCase();
          const isNoRoute =
            lower.includes('no_route') ||
            lower.includes('failure_reason_no_route') ||
            lower.includes('ran out of routes');

          if (!isNoRoute) throw meltErr; // non-route error → outer catch

          // ── Auto-route through middleman ──
          appendDebug({ event: 'no_route_auto_routing', stepId: id, fromMintUrl, toMintUrl });

          updateStepState(id, {
            status: 'routing',
            errorMessage: undefined,
            routingDetail: 'Searching for middleman route…',
            routeSuggestion: { status: 'searching' },
          });

          // Restore any proofs stuck in "inflight" by the failed melt so they're
          // available for the middleman chain. This is the app-level equivalent of
          // the debug panel's "Restore Inflight" button.
          await CocoManager.restoreInflightProofsForMint(fromMintUrl);

          // ── Build candidate paths ──
          // 1. Try the BFS graph (auditor + local history merged) for the best scored path
          // 2. If BFS finds nothing, fall back to local history candidates: mints we know
          //    have successfully swapped TO the destination. We "just try" each one —
          //    if a hop fails, we move to the next candidate.
          type CandidateRoute = { path: string[]; pathNames: string[]; source: string };
          const candidateRoutes: CandidateRoute[] = [];

          const suggestion = await computeRouteSuggestion(fromMintUrl, toMintUrl);

          if (suggestion?.path && suggestion.path.length >= 3) {
            candidateRoutes.push({
              path: suggestion.path,
              pathNames: suggestion.pathNames ?? suggestion.path.map(extractDomain),
              source: 'graph',
            });
          }

          // Even if BFS found a path, also add local history candidates as fallbacks
          // (in case the BFS-scored path fails at runtime)
          const allSwapGroups = Object.values(useSwapTransactionsStore.getState().groups);
          const localFallbacks = getLocalCandidatesForDestination(
            allSwapGroups,
            toMintUrl,
            fromMintUrl
          );

          for (const candidateUrl of localFallbacks) {
            // Skip if this candidate is already part of the BFS path
            const alreadyInBfs = candidateRoutes.some(
              (r) => r.source === 'graph' && r.path.includes(candidateUrl)
            );
            if (alreadyInBfs) continue;

            candidateRoutes.push({
              path: [fromMintUrl, candidateUrl, toMintUrl],
              pathNames: [
                mintInfoMap[fromMintUrl]?.name || extractDomain(fromMintUrl),
                mintInfoMap[candidateUrl]?.name || extractDomain(candidateUrl),
                mintInfoMap[toMintUrl]?.name || extractDomain(toMintUrl),
              ],
              source: 'local_history',
            });
          }

          appendDebug({
            event: 'routing_candidates',
            stepId: id,
            candidateCount: candidateRoutes.length,
            candidates: candidateRoutes.map((r) => ({
              path: r.path.map(extractDomain),
              source: r.source,
            })),
          });

          if (candidateRoutes.length === 0) {
            appendDebug({ event: 'no_route_no_middleman', stepId: id });
            throw meltErr;
          }

          // ── Try each candidate route sequentially ──
          let anyRouteSucceeded = false;
          let lastCandidateError: unknown = meltErr;

          for (let candidateIdx = 0; candidateIdx < candidateRoutes.length; candidateIdx++) {
            if (abortRef.current || runIdRef.current !== runId) break;

            const candidate = candidateRoutes[candidateIdx];
            const chainPath = candidate.path;
            const chainPathNames = candidate.pathNames;

            appendDebug({
              event: 'trying_candidate_route',
              stepId: id,
              candidateIdx,
              candidateCount: candidateRoutes.length,
              chainPath: chainPath.map(extractDomain),
              source: candidate.source,
            });

            updateStepState(id, {
              routeSuggestion: { status: 'found', path: chainPath, pathNames: chainPathNames },
              routingDetail:
                candidateRoutes.length > 1
                  ? `Trying route ${candidateIdx + 1}/${candidateRoutes.length}: via ${chainPathNames.slice(1, -1).join(' → ')}…`
                  : `Routing via ${chainPathNames.slice(1, -1).join(' → ')}…`,
            });

            // Trust intermediary mints temporarily
            const trustedUrls = new Set(trustedMints.map((m) => m.mintUrl));
            const intermediaries = chainPath.slice(1, -1);
            const temporarilyTrusted: string[] = [];

            for (const url of intermediaries) {
              if (!trustedUrls.has(url)) {
                try {
                  try {
                    await manager.mint.addMint(url);
                  } catch {
                    /* already added */
                  }
                  await manager.mint.trustMint(url);
                  temporarilyTrusted.push(url);
                } catch (trustErr) {
                  console.warn('Failed to temporarily trust intermediary:', url, trustErr);
                }
              }
            }

            // Insert one visible row per hop immediately (swap-like grouped chain UX)
            const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
            const chainId = `chain-${uniqueSuffix}`;
            const autoRouteSteps: TransferStep[] = [];
            for (let i = 0; i < chainPath.length - 1; i++) {
              autoRouteSteps.push({
                ...step,
                id: `auto-route-${id}-${candidateIdx}-${i}-${uniqueSuffix}`,
                fromMintUrl: chainPath[i],
                toMintUrl: chainPath[i + 1],
                chainId,
                chainPath,
                chainHopIndex: i,
              });
            }

            setRunPlan((prev) => {
              if (!prev) return prev;
              const idx = prev.steps.findIndex((s) => s.id === id);
              if (idx === -1) return prev;
              return {
                ...prev,
                steps: [
                  ...prev.steps.slice(0, idx + 1),
                  ...autoRouteSteps,
                  ...prev.steps.slice(idx + 1),
                ],
              };
            });

            const nextStates = { ...stepStatesRef.current };
            nextStates[id] = {
              ...nextStates[id],
              status: 'skipped',
              routingDetail:
                candidateRoutes.length > 1
                  ? `Trying route ${candidateIdx + 1}/${candidateRoutes.length}: via ${chainPathNames.slice(1, -1).join(' → ')}…`
                  : `Routing via ${chainPathNames.slice(1, -1).join(' → ')}…`,
            };
            for (const hopStep of autoRouteSteps) {
              nextStates[hopStep.id] = { status: 'pending' };
            }
            stepStatesRef.current = nextStates;
            setStepStates(nextStates);

            let chainSuccess = true;

            try {
              for (let hopIdx = 0; hopIdx < chainPath.length - 1; hopIdx++) {
                if (abortRef.current || runIdRef.current !== runId) {
                  chainSuccess = false;
                  break;
                }

                const hopFrom = chainPath[hopIdx];
                const hopTo = chainPath[hopIdx + 1];
                const hopLabel = `${extractDomain(hopFrom)} → ${extractDomain(hopTo)}`;
                const hopStep = autoRouteSteps[hopIdx];
                const hopStepId = hopStep.id;
                finalAutoRouteStepId = hopStepId;
                updateStepState(hopStepId, {
                  status: 'creatingInvoice',
                  errorMessage: undefined,
                  routingDetail: `Hop ${hopIdx + 1}/${chainPath.length - 1}: ${hopLabel}`,
                });

                // Get fresh balance for this hop's source
                const hopBalances = await manager.wallet.getBalances();
                const hopSourceBalance = hopBalances[hopFrom] || 0;

                // ── Per-hop dynamic fee headroom ──
                // Each hop's source mint may have different input_fee_ppk, so
                // compute the headroom specifically for this hop's source mint.
                let hopFeeHeadroom = STATIC_FEE_HEADROOM;
                try {
                  const hopProofs = await manager.proofService.getReadyProofs(hopFrom);
                  const hopWallet = await manager.walletService.getWallet(hopFrom);
                  const hopInputFee = hopWallet.getFeesForProofs(hopProofs as any);
                  hopFeeHeadroom = Math.max(STATIC_FEE_HEADROOM, MIN_FEE_RESERVE + hopInputFee);
                } catch {
                  // Fallback to static headroom if proof query fails
                }

                // Determine hop amount
                let hopAmount: number;
                if (hopIdx === 0) {
                  hopAmount = Math.min(transferAmount, hopSourceBalance - hopFeeHeadroom);
                } else {
                  // Use whatever landed on the intermediary, minus fee headroom
                  hopAmount = hopSourceBalance - hopFeeHeadroom;
                }

                if (hopAmount < minTransferThreshold) {
                  appendDebug({
                    event: 'chain_hop_insufficient',
                    stepId: id,
                    hopIdx,
                    hopAmount,
                    hopSourceBalance,
                  });
                  chainSuccess = false;
                  break;
                }

                appendDebug({
                  event: 'chain_hop_start',
                  stepId: id,
                  hopIdx,
                  hopFrom,
                  hopTo,
                  hopAmount,
                  hopSourceBalance,
                });

                // Create invoice on receiving mint
                let hopMq = await requestLightningInvoice(hopTo, hopAmount);
                let hopInvoice = hopMq.request;
                updateStepState(hopStepId, { status: 'invoiceReady', invoice: hopInvoice });

                // ── Probe melt quote for this hop's actual fee_reserve ──
                try {
                  const hopProbeWallet = await manager.walletService.getWallet(hopFrom);
                  const hopProbeQuote = await (hopProbeWallet as any).createMeltQuoteBolt11(
                    hopInvoice
                  );
                  const hopActualFeeReserve = Number(hopProbeQuote.fee_reserve ?? 0);

                  if (hopActualFeeReserve > 0) {
                    // Recompute hop fee headroom with probed fee_reserve
                    let hopProbeInputFee = 0;
                    try {
                      const hpProofs = await manager.proofService.getReadyProofs(hopFrom);
                      const hpWallet = await manager.walletService.getWallet(hopFrom);
                      hopProbeInputFee = hpWallet.getFeesForProofs(hpProofs as any);
                    } catch {
                      /* use 0 */
                    }
                    const hopProbedHeadroom = hopActualFeeReserve + hopProbeInputFee;

                    if (hopAmount + hopProbedHeadroom > hopSourceBalance) {
                      const cappedHop = hopSourceBalance - hopProbedHeadroom;
                      if (cappedHop >= minTransferThreshold) {
                        appendDebug({
                          event: 'hop_amount_recapped_after_probe',
                          stepId: id,
                          hopIdx,
                          original: hopAmount,
                          capped: cappedHop,
                          hopSourceBalance,
                          hopProbedHeadroom,
                        });
                        hopAmount = cappedHop;
                        hopMq = await requestLightningInvoice(hopTo, hopAmount);
                        hopInvoice = hopMq.request;
                        updateStepState(hopStepId, { status: 'invoiceReady', invoice: hopInvoice });
                      }
                    }
                  }
                } catch {
                  // Probe failed — proceed with existing estimate
                }

                // Tag leg in swap store
                const hopLegId = groupId
                  ? useSwapTransactionsStore.getState().addLeg(groupId, {
                      fromMintUrl: hopFrom,
                      toMintUrl: hopTo,
                      amount: hopAmount,
                      chainId,
                      chainPath,
                      chainHopIndex: hopIdx,
                    })
                  : null;

                if (groupId && hopLegId) {
                  const mqId =
                    (hopMq as any)?.quote ?? (hopMq as any)?.quoteId ?? (hopMq as any)?.id;
                  if (mqId) {
                    useSwapTransactionsStore
                      .getState()
                      .tagMintQuote(groupId, hopLegId, String(mqId));
                  }
                  useSwapTransactionsStore
                    .getState()
                    .setLegStatus(groupId, hopLegId, { localStatus: 'melting' });
                }

                // Prepare melt with retry for "Not enough proofs"
                let hopPrepared: any = null;
                let hopTransferAmt = hopAmount;
                for (let att = 0; att <= MAX_PREPARE_RETRIES; att++) {
                  try {
                    hopPrepared = await manager.quotes.prepareMeltBolt11(hopFrom, hopInvoice);
                    break;
                  } catch (pErr) {
                    const pm = pErr instanceof Error ? pErr.message : String(pErr);
                    if (pm.includes('Not enough proofs') && att < MAX_PREPARE_RETRIES) {
                      hopTransferAmt -= RETRY_REDUCE_SATS;
                      if (hopTransferAmt < minTransferThreshold) throw pErr;
                      const retryMq = await requestLightningInvoice(hopTo, hopTransferAmt);
                      hopInvoice = retryMq.request;
                      updateStepState(hopStepId, { status: 'invoiceReady', invoice: hopInvoice });
                      continue;
                    }
                    throw pErr;
                  }
                }

                // Execute melt
                updateStepState(hopStepId, { status: 'melting' });
                const hopResult = (await manager.quotes.executeMelt(hopPrepared.id)) as unknown as
                  | { state?: string; id?: string }
                  | undefined;

                // Handle pending state
                if (hopResult?.state === 'pending') {
                  const opId = hopResult.id ?? hopPrepared.id;
                  const maxWait = 15000;
                  const start = Date.now();
                  while (Date.now() - start < maxWait) {
                    const dec = await manager.quotes.checkPendingMelt(opId);
                    if (dec === 'finalize') break;
                    if (dec === 'rollback') throw new Error('Hop melt rolled back');
                    await new Promise((r) => setTimeout(r, 2000));
                  }
                }

                // Tag melt in swap store
                if (groupId && hopLegId) {
                  const qId = (hopPrepared as any)?.quoteId ?? hopPrepared.id;
                  useSwapTransactionsStore.getState().tagMelt(groupId, hopLegId, {
                    quoteId: String(qId),
                    operationId: String(hopPrepared.id),
                  });
                  useSwapTransactionsStore.getState().setLegStatus(groupId, hopLegId, {
                    localStatus: 'verifying',
                  });
                }
                updateStepState(hopStepId, {
                  status: 'verifying',
                  operationId: String(hopPrepared.id),
                });

                appendDebug({
                  event: 'chain_hop_done',
                  stepId: id,
                  hopIdx,
                  hopFrom,
                  hopTo,
                  amount: hopTransferAmt,
                });

                // Wait for balance on the receiving mint before next hop
                if (hopIdx < chainPath.length - 2) {
                  await waitForBalanceIncrease(hopTo, hopTransferAmt, 12000);
                  updateStepState(hopStepId, { status: 'done', routingDetail: undefined });
                  if (groupId && hopLegId) {
                    useSwapTransactionsStore
                      .getState()
                      .setLegStatus(groupId, hopLegId, { localStatus: 'done' });
                  }
                }
              }
            } catch (hopErr) {
              appendDebug({
                event: 'chain_candidate_error',
                stepId: id,
                candidateIdx,
                chainPath: chainPath.map(extractDomain),
                error: hopErr instanceof Error ? hopErr.message : String(hopErr),
              });
              // Restore inflight proofs on ALL mints in the chain so they're
              // available for the next candidate attempt
              for (const url of chainPath) {
                await CocoManager.restoreInflightProofsForMint(url);
              }
              const failedHopMessage = hopErr instanceof Error ? hopErr.message : String(hopErr);
              if (finalAutoRouteStepId) {
                updateStepState(finalAutoRouteStepId, {
                  status: 'failed',
                  errorMessage: failedHopMessage,
                });
              }
              const cleanupStates = { ...stepStatesRef.current };
              for (const hopStep of autoRouteSteps) {
                if (cleanupStates[hopStep.id]?.status === 'pending') {
                  cleanupStates[hopStep.id] = { ...cleanupStates[hopStep.id], status: 'skipped' };
                }
              }
              stepStatesRef.current = cleanupStates;
              setStepStates(cleanupStates);
              chainSuccess = false;
              lastCandidateError = hopErr;
            }

            // Untrust temporary intermediaries (if no funds remain)
            const finalBals = await manager.wallet
              .getBalances()
              .catch(() => ({}) as Record<string, number>);
            for (const url of temporarilyTrusted) {
              const bal = finalBals[url] ?? 0;
              if (bal > 0) {
                console.warn(`Keeping temp middleman ${url} trusted — ${bal} sats remain`);
                continue;
              }
              try {
                await manager.mint.untrustMint(url);
              } catch {
                /* ignore */
              }
            }

            if (chainSuccess) {
              meltSucceeded = true;
              anyRouteSucceeded = true;
              appendDebug({
                event: 'auto_route_chain_complete',
                stepId: id,
                chainPath,
                candidateIdx,
              });
              break; // success — stop trying candidates
            }

            // Chain failed — give coco a moment to settle before trying next candidate
            appendDebug({
              event: 'candidate_route_failed_trying_next',
              stepId: id,
              candidateIdx,
              remainingCandidates: candidateRoutes.length - candidateIdx - 1,
            });
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }

          if (!anyRouteSucceeded) {
            const triedCount = candidateRoutes.length;
            throw triedCount > 1
              ? new Error(
                  `All ${triedCount} middleman routes failed. Some funds may be on intermediary mints — check the debug panel.`
                )
              : lastCandidateError;
          }
        }

        // Step 4: Verify - wait for balance to increase on receiving mint
        // The MintQuoteProcessor runs every 5 seconds to claim paid quotes
        if (finalAutoRouteStepId) {
          updateStepState(finalAutoRouteStepId, { status: 'verifying', routingDetail: undefined });
        } else {
          updateStepState(id, { status: 'verifying', routingDetail: undefined });
          setLegLocalStatus('verifying');
        }

        // Poll for up to 15 seconds for the balance to update
        const balanceUpdated = await waitForBalanceIncrease(toMintUrl, transferAmount, 15000);

        if (!balanceUpdated && meltSucceeded) {
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
        if (finalAutoRouteStepId) {
          updateStepState(finalAutoRouteStepId, {
            status: 'done',
            routingDetail: undefined,
          });
        } else {
          updateStepState(id, {
            status: 'done',
            routingDetail: undefined,
          });
          setLegLocalStatus('done');
        }

        appendDebug({
          event: 'step_done',
          stepId: id,
          fromMintUrl,
          toMintUrl,
          amount: transferAmount,
        });

        // Add a small delay between steps to avoid overwhelming the mints
        await new Promise((resolve) => setTimeout(resolve, 500));
        return true;
      } catch (error) {
        // Sanity check: restore any proofs stuck in "inflight" on the source mint
        await CocoManager.restoreInflightProofsForMint(fromMintUrl);

        const rawErrorMessage = error instanceof Error ? error.message : String(error);
        const rawStack = error instanceof Error ? error.stack : undefined;

        appendDebug({
          event: 'step_error',
          stepId: id,
          fromMintUrl,
          toMintUrl,
          amount: originalAmount,
          error: rawErrorMessage,
          stack: rawStack,
          errorObject: String(error),
        });

        let errorMessage = error instanceof Error ? error.message : 'Transfer failed';

        // Parse and improve error messages for common Lightning/mint errors
        if (errorMessage.includes('lnd is not ready') || errorMessage.includes('not ready for')) {
          errorMessage =
            'Mint Lightning node is not ready. The mint may be starting up or syncing. Try again in a few minutes.';
        } else if (
          errorMessage.toLowerCase().includes('no_route') ||
          errorMessage.toLowerCase().includes('ran out of routes')
        ) {
          errorMessage = 'No Lightning route found. No middleman route available either.';
        } else if (errorMessage.includes('FAILURE_REASON_TIMEOUT')) {
          errorMessage = 'Lightning payment timed out. The mint may be slow to respond.';
        } else if (errorMessage.includes('invoice expired') || errorMessage.includes('EXPIRED')) {
          errorMessage = 'Invoice expired before payment could complete. Please retry.';
        } else if (errorMessage.includes('insufficient')) {
          errorMessage = 'Insufficient balance or liquidity for this transfer.';
        }

        updateStepState(id, {
          status: 'failed',
          errorMessage,
          routingDetail: undefined,
        });
        setLegLocalStatus('failed', errorMessage);
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
      minTransferThreshold,
      appendDebug,
      trustedMints,
      mintInfoMap,
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
        if (swapGroupIdRef.current) {
          useSwapTransactionsStore.getState().finalizeGroup(swapGroupIdRef.current, 'finished');
        }
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

    // Start a swap group for this run (used for Transactions grouping)
    swapLegIdByStepIdRef.current = {};
    swapGroupIdRef.current = useSwapTransactionsStore
      .getState()
      .startGroup({ unit, title: 'Swap' });

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
  }, [computedPlan, runStatus, runStepsSequentially, unit]);

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

  // Handle done - dismiss everything back to home
  const handleDone = useCallback(() => {
    router.dismissTo('/');
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
      if (!suggestion || suggestion.status !== 'found' || !suggestion.path) return;

      const chainPath = suggestion.path;
      if (chainPath.length < 3) return; // Need at least A → via → B

      isRunningRef.current = true;

      // ── Temporary trust for untrusted intermediary mints ──
      // In `allow_untrusted` mode, coco requires mints to be trusted for wallet
      // operations.  We temporarily trust any intermediary mint the user hasn't
      // explicitly trusted, then untrust it after the chain finishes.
      const trustedUrls = new Set(trustedMints.map((m) => m.mintUrl));
      const intermediaries = chainPath.slice(1, -1);
      const temporarilyTrusted: string[] = [];

      for (const url of intermediaries) {
        if (!trustedUrls.has(url)) {
          try {
            // addMint may throw if the mint is already added; that's fine,
            // we just need it to exist before calling trustMint.
            try {
              await manager.mint.addMint(url);
            } catch {
              // already added — ignore
            }
            await manager.mint.trustMint(url);
            temporarilyTrusted.push(url);
          } catch (err) {
            console.warn('Failed to temporarily trust intermediary mint:', url, err);
          }
        }
      }

      const afterId = step.id;
      const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const chainId = `chain-${uniqueSuffix}`;

      // Create one TransferStep per hop in the path
      const rerouteSteps: TransferStep[] = [];
      for (let i = 0; i < chainPath.length - 1; i++) {
        rerouteSteps.push({
          ...step,
          id: `reroute-${afterId}-${i}-${uniqueSuffix}`,
          fromMintUrl: chainPath[i],
          toMintUrl: chainPath[i + 1],
          chainId,
          chainPath,
          chainHopIndex: i,
        });
      }

      const insertAfter = (arr: TransferStep[], id: string, toInsert: TransferStep[]) => {
        const idx = arr.findIndex((s) => s.id === id);
        if (idx === -1) return arr;
        return [...arr.slice(0, idx + 1), ...toInsert, ...arr.slice(idx + 1)];
      };

      const nextSteps = insertAfter(runPlan.steps, afterId, rerouteSteps);
      setRunPlan((prev) => (prev ? { ...prev, steps: nextSteps } : prev));

      /**
       * We keep the original step visible (marked skipped) so the user can see what happened.
       * New chain steps are inserted immediately after it.
       *
       * Important: update `stepStatesRef` immediately so the runner (which reads the ref) sees the new steps.
       */
      const nextStates = { ...stepStatesRef.current };
      nextStates[afterId] = { ...nextStates[afterId], status: 'skipped' };
      for (const rs of rerouteSteps) {
        nextStates[rs.id] = { status: 'pending' };
      }
      stepStatesRef.current = nextStates;
      setStepStates(nextStates);

      // Immediately execute pending steps (Start once behavior)
      abortRef.current = false;
      const runId = (runIdRef.current += 1);
      setRunStatus('running');
      setCurrentStepId(null);

      try {
        await runStepsSequentially(nextSteps, runId);
      } finally {
        // ── Revoke temporary trust ──
        // Only untrust intermediary mints whose balance is zero. If a chain
        // failed mid-way, the user may have ecash stranded on the intermediary;
        // keeping it trusted lets them recover those funds.
        const balances = await manager.wallet
          .getBalances()
          .catch(() => ({}) as Record<string, number>);
        for (const url of temporarilyTrusted) {
          const bal = balances[url] ?? 0;
          if (bal > 0) {
            console.warn(`Keeping temporary middleman ${url} trusted — ${bal} sats still on mint`);
            continue;
          }
          try {
            await manager.mint.untrustMint(url);
          } catch (err) {
            console.warn('Failed to untrust temporary middleman mint:', url, err);
          }
        }
      }
    },
    [runPlan, runStatus, runStepsSequentially, trustedMints, manager]
  );

  const handleCancelRun = useCallback(() => {
    // Best-effort abort: we can't cancel an in-flight melt, but we can stop scheduling new steps.
    abortRef.current = true;
    runIdRef.current += 1;
    isRunningRef.current = false;
    setRunStatus('cancelled');
    setCurrentStepId(null);

    if (swapGroupIdRef.current) {
      useSwapTransactionsStore.getState().finalizeGroup(swapGroupIdRef.current, 'cancelled');
    }
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
                      backgroundColor: failedCount > 0 ? danger : greenColor,
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
            {runPlan && skippedCount > 0 && (
              <HStack justify="space-between" align="center">
                <Text size={14} style={{ color: primaryColor300 }}>
                  Skipped
                </Text>
                <Text bold overpass size={18} style={{ color: primaryColor400 }}>
                  {skippedCount}
                </Text>
              </HStack>
            )}
            {runPlan && (
              <HStack justify="space-between" align="center">
                <Text size={14} style={{ color: primaryColor300 }}>
                  Errors
                </Text>
                <Text
                  bold
                  overpass
                  size={18}
                  style={{ color: failedCount > 0 ? danger : primaryColor0 }}>
                  {failedCount}
                </Text>
              </HStack>
            )}
            <Text size={11} style={{ color: primaryColor400 }}>
              Transfers under {minTransferThreshold} sats are ignored
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
                All differences are below the {minTransferThreshold} sat threshold.
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
                  routingDetail={state.routingDetail}
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
                  chainInfo={
                    step.chainId && step.chainPath
                      ? {
                          chainId: step.chainId,
                          chainPath: step.chainPath,
                          chainHopIndex: step.chainHopIndex ?? 0,
                          pathMintInfos: step.chainPath.map((url) => mintInfoMap[url] ?? null),
                        }
                      : undefined
                  }
                />
              );
            })}
          </VStack>
        )}

        {/* View Swap button — shown when run finishes */}
        {runStatus === 'finished' && plan.steps.length > 0 && swapGroupIdRef.current && (
          <View style={styles.viewSwapContainer}>
            <TouchableOpacity
              haptics
              onPress={() => {
                router.navigate({
                  pathname: '/swap' as any,
                  params: { groupId: swapGroupIdRef.current! },
                });
              }}>
              <View style={[styles.viewSwapButton, { borderColor: primaryColor700 }]}>
                <BlurCardFrame accentColor={primaryColor300}>
                  <View style={styles.viewSwapContent}>
                    <Text size={14} bold style={{ color: primaryColor0 }}>
                      View Swap
                    </Text>
                  </View>
                </BlurCardFrame>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Debug log – raw JSON of every event / error */}
        {debugLog.length > 0 && (
          <View style={styles.debugContainer}>
            <HStack justify="space-between" align="center" style={{ marginBottom: 4 }}>
              <Text size={11} weight="bold" style={{ color: '#facc15' }}>
                REBALANCE DEBUG LOG ({debugLog.length} entries)
              </Text>
              <TouchableOpacity
                onPress={() => {
                  console.log('[REBALANCE] === FULL DEBUG LOG DUMP ===');
                  debugLog.forEach((entry, i) =>
                    console.log(`[REBALANCE] [${i}]`, JSON.stringify(entry))
                  );
                  console.log('[REBALANCE] === END DUMP ===');
                }}
                style={styles.debugDumpBtn}>
                <Text size={9} weight="bold" style={{ color: '#facc15' }}>
                  Log All
                </Text>
              </TouchableOpacity>
            </HStack>
            <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled showsVerticalScrollIndicator>
              <Text
                size={9}
                style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace' }}
                selectable>
                {JSON.stringify(debugLog, null, 2)}
              </Text>
            </ScrollView>
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
  viewSwapContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  viewSwapButton: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  viewSwapContent: {
    padding: 12,
    alignItems: 'center',
    zIndex: 1,
  },
  debugContainer: {
    margin: 16,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.3)',
  },
  debugDumpBtn: {
    backgroundColor: 'rgba(250,204,21,0.15)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.3)',
  },
});

export default withSheetProvider(RebalancePlanScreen);
