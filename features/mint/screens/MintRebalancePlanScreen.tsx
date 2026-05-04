import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Stack, router } from 'expo-router';
import opacity from 'hex-color-opacity';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { z } from 'zod';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Screen } from '@/shared/ui/composed/Screen';
import { useMints, useBalanceContext, useManager } from '@cashu/coco-react';
import type { GetInfoResponse, Proof } from '@cashu/cashu-ts';
import { getReadyProofs, getWallet } from '@/shared/lib/cashu/managerInternals';
import { useMintManagement } from '@/features/mint/hooks/useMintManagement';
import { MIN_FEE_RESERVE } from '@/features/mint/components/rebalance';

import {
  EMPTY_DISTRIBUTION,
  useMintDistributionStore,
} from '@/shared/stores/profile/mintDistributionStore';
import {
  useSwapTransactionsStore,
  type SwapLegLocalStatus,
} from '@/shared/stores/profile/swapTransactionsStore';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import { swapStatusPopup } from '@/shared/lib/popup';
import {
  RebalanceStepRow,
  RebalanceChainCard,
  groupStepsForDisplay,
  computeRebalancePlan,
  isAlreadyBalanced,
  buildSwapGraph,
  pickIntermediaryPath,
  addLocalHistoryEdges,
  getLocalCandidatesForDestination,
  releaseTrustWindow,
  formatStrandedRoutingDetail,
  type TransferStep,
  type RebalancePlan,
  type StepStatus,
  type StepState,
} from '@/features/mint/components/rebalance';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { CocoManager } from '@/shared/lib/cashu/manager';
import Icon from 'assets/icons';
import { auditMint, type AuditMintResponse } from '@/shared/lib/apiClient';
import { extractDomain } from '@/shared/lib/url';
import { mintLocalId } from '@/shared/lib/id';
import { cashuLog, useLifecycleLogger } from '@/shared/lib/logger';

// StepState is imported from components/blocks/rebalance (groupSteps.ts)

const ParamsSchema = z.object({
  unit: z.string().max(16).optional(),
});

export function MintRebalancePlanScreen() {
  useLifecycleLogger('MintRebalancePlanScreen');
  const [foreground, surfaceTertiary, surfaceSecondary, background] = useThemeColor([
    'foreground',
    'surface-tertiary',
    'surface-secondary',
    'background',
  ] as const);
  const [danger, green400] = useThemeColor(['danger', 'green-400'] as const);
  const fgMuted = opacity(foreground, 0.5);
  const fgDim = opacity(foreground, 0.4);

  const params = useRouteParams(ParamsSchema, { where: 'mint-flow.rebalancePlan' });
  const unit = params?.unit?.toLowerCase() || 'sat';

  const { trustedMints } = useMints();
  const { balances: liveBalanceCtx } = useBalanceContext();
  const liveBalances = liveBalanceCtx.byMint;
  const { getMintInfo } = useMintManagement();
  const manager = useManager();
  const requestLightningInvoice = useCallback(
    (mintUrl: string, amount: number) =>
      manager.ops.mint.prepare({ mintUrl, amount, method: 'bolt11' }),
    [manager]
  );
  const middlemanRouting = useSettingsStore((state) => state.middlemanRouting);
  const minTransferThreshold = useSettingsStore((state) => state.minTransferThreshold);
  const [mintInfoMap, setMintInfoMap] = useState<Record<string, GetInfoResponse | null>>({});

  // Narrow the selector to the per-unit slice. Returning the whole `distributions`
  // record made any write to any unit re-render this screen even though only the
  // active unit's slice is read. Falling back to a shared frozen empty object keeps
  // the reference stable when the unit has no entry yet.
  const distribution = useMintDistributionStore(
    (state) => state.distributions[unit] ?? EMPTY_DISTRIBUTION
  );

  const mintsForUnit = useMemo(() => {
    return trustedMints.filter((mint) => {
      if (unit === 'sat') {
        if (!mint.mintInfo?.nuts?.['4']?.methods) return true;
        return mint.mintInfo.nuts['4'].methods.some(
          (method) => method.unit?.toLowerCase() === 'sat'
        );
      }
      if (!mint.mintInfo?.nuts?.['4']?.methods) return false;
      return mint.mintInfo.nuts['4'].methods.some((method) => method.unit?.toLowerCase() === unit);
    });
  }, [trustedMints, unit]);

  const mintUrls = useMemo(() => mintsForUnit.map((m) => m.mintUrl), [mintsForUnit]);

  useEffect(() => {
    let cancelled = false;
    const loadMintInfo = async () => {
      const results = await Promise.allSettled(
        trustedMints.map((mint) =>
          getMintInfo(mint.mintUrl).then(
            (info) => [mint.mintUrl, info] as const,
            () => [mint.mintUrl, mint.mintInfo || null] as const
          )
        )
      );
      if (cancelled) return;
      const infoMap: Record<string, GetInfoResponse | null> = {};
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const [url, info] = r.value;
          infoMap[url] = info;
        }
      }
      setMintInfoMap(infoMap);
    };
    loadMintInfo();
    return () => {
      cancelled = true;
    };
  }, [trustedMints, getMintInfo]);

  const computedPlan = useMemo(() => {
    const mintBalances = mintUrls.map((mintUrl) => ({
      mintUrl,
      balance: liveBalances[mintUrl]?.total || 0,
    }));
    return computeRebalancePlan(mintBalances, distribution, minTransferThreshold);
  }, [mintUrls, liveBalances, distribution, minTransferThreshold]);

  const [runPlan, setRunPlan] = useState<RebalancePlan | null>(null);
  const [stepStates, setStepStates] = useState<Record<string, StepState>>({});
  const stepStatesRef = useRef<Record<string, StepState>>({});
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'finished' | 'cancelled'>('idle');
  const [, setCurrentStepId] = useState<string | null>(null);

  const runIdRef = useRef(0);
  const abortRef = useRef(false);
  const executionLockRef = useRef(false);
  const auditCacheRef = useRef<Map<string, AuditMintResponse>>(new Map());
  const isRunningRef = useRef(false);
  const swapGroupIdRef = useRef<string | null>(null);
  const swapLegIdByStepIdRef = useRef<Record<string, string>>({});

  const appendDebug = useCallback((entry: Record<string, unknown>) => {
    cashuLog.debug('mint.rebalance.step', entry);
  }, []);

  const plan = useMemo(() => runPlan ?? computedPlan, [runPlan, computedPlan]);

  useEffect(() => {
    stepStatesRef.current = stepStates;
  }, [stepStates]);

  // No unmount-abort: the swap orchestration runs as a closure-bound async
  // loop, and `useSwapStatusStore` + the unified SwapStatusToast both live
  // outside the React tree. Letting the loop continue means the user can
  // back out of this screen mid-swap and the swap finishes silently in the
  // background — the toast keeps reporting progress, and the "View" button
  // navigates into the SwapTransactionScreen for full detail. Local
  // `setStepStates` calls after unmount are silent no-ops in React 19.

  const alreadyBalanced = useMemo(() => {
    return isAlreadyBalanced(plan.currentBalances, plan.targetBalances, minTransferThreshold);
  }, [plan, minTransferThreshold]);

  const stepCounts = useMemo(() => {
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    let executing = false;
    for (const step of plan.steps) {
      const s = stepStates[step.id]?.status;
      if (s === 'done') completed++;
      else if (s === 'failed') failed++;
      else if (s === 'skipped') skipped++;
      else if (
        s === 'creatingInvoice' ||
        s === 'invoiceReady' ||
        s === 'melting' ||
        s === 'verifying' ||
        s === 'routing'
      )
        executing = true;
    }
    const terminal = completed + failed + skipped;
    return {
      completed,
      failed,
      skipped,
      executing,
      allComplete: runPlan ? terminal === plan.steps.length : false,
      progressPct:
        !runPlan || plan.steps.length === 0
          ? 0
          : Math.max(0, Math.min(1, terminal / plan.steps.length)),
      hasFailedStep: failed > 0,
    };
  }, [plan.steps, stepStates, runPlan]);

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

  const waitForBalanceIncrease = useCallback(
    async (mintUrl: string, _expectedIncrease: number, maxWaitMs: number = 15000) => {
      // Get fresh balances directly from manager to avoid stale closure
      const getBalances = async () => {
        try {
          return await manager.wallet.balances.byMint();
        } catch (error) {
          // Don't swallow silently — a transient balance-fetch failure looks
          // identical to a real "balance didn't increase" timeout downstream,
          // and that ambiguity hides operator-actionable network issues.
          cashuLog.warn('mint.rebalance.balance_fetch_failed', { mintUrl, error });
          return {};
        }
      };

      const initialBalances = await getBalances();
      const startBalance = initialBalances[mintUrl]?.total || 0;
      const startTime = Date.now();
      const pollInterval = 1000; // Check every 1 second

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        const currentBalances = await getBalances();
        const currentBalance = currentBalances[mintUrl]?.total || 0;

        // Allow for some fee variance - consider success if balance increased
        if (currentBalance > startBalance) {
          return true;
        }
      }

      return false;
    },
    [manager]
  );

  const waitForLock = useCallback(async (maxWaitMs: number = 30000): Promise<boolean> => {
    const startTime = Date.now();
    const pollInterval = 100;

    while (executionLockRef.current) {
      if (Date.now() - startTime > maxWaitMs) {
        cashuLog.warn('mint.rebalance.lock_timeout');
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
    return true;
  }, []);

  const releaseTemporaryTrust = useCallback(
    async (temporarilyTrusted: string[], warnStepId: string | undefined) => {
      const { stranded, untrustErrors } = await releaseTrustWindow(manager, temporarilyTrusted);
      for (const { url, error } of untrustErrors) {
        cashuLog.warn('mint.rebalance.untrust_failed', { url, error });
      }
      if (stranded.length > 0) {
        // Louder than the previous silent log.warn — this is a recovery_required
        // signal: funds remain on an intermediary the user did not pre-trust.
        cashuLog.warn('mint.rebalance.middleman_recovery_required', { stranded });
        if (warnStepId) {
          updateStepState(warnStepId, {
            routingDetail: formatStrandedRoutingDetail(stranded),
          });
        }
      }
    },
    [manager, updateStepState]
  );

  const executeStep = useCallback(
    async (step: TransferStep, runId: number): Promise<boolean> => {
      if (abortRef.current || runIdRef.current !== runId) return false;

      // Prevent concurrent melt operations
      // Coco operations are stateful (proof selection, inflight tracking, etc). Running melts in parallel
      // can lead to "melt already in progress" or confusing intermediate states.
      // Wait for any existing operation to complete instead of returning early
      const gotLock = await waitForLock();
      if (!gotLock) {
        cashuLog.warn('mint.rebalance.lock_failed', { stepId: step.id });
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
        const currentBalances = await manager.wallet.balances.byMint();
        const sourceBalance = currentBalances[fromMintUrl]?.total || 0;

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
          const proofs = await getReadyProofs(manager, fromMintUrl);
          const wallet = await getWallet(manager, fromMintUrl);
          worstCaseInputFee = wallet.getFeesForProofs(proofs as unknown as Proof[]);
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
          useSwapStatusStore.getState().setLegSkipped(id);
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

        // Helper: create invoice + tag the leg. When called with a previous
        // quote, log it as orphaned — the previous mint quote on the
        // destination mint is now unreachable but the mint will hold it open
        // until expiry. Surfacing the id makes the leak observable to
        // log-doctor's coco view.
        const createInvoiceForAmount = async (amt: number, previous?: { quoteId?: string }) => {
          if (previous?.quoteId) {
            appendDebug({
              event: 'mint_quote_orphaned',
              stepId: id,
              orphanedQuoteId: previous.quoteId,
              toMintUrl,
              reason: 'amount_changed',
            });
          }
          const mq = await requestLightningInvoice(toMintUrl, amt);
          const legId = ensureLegId();
          if (groupId && legId && mq.quoteId) {
            useSwapTransactionsStore.getState().tagMintQuote(groupId, legId, mq.quoteId);
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
          const probeWallet = await getWallet(manager, fromMintUrl);
          const probeQuote = await probeWallet.createMeltQuoteBolt11(invoice);
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
                mintQuote = await createInvoiceForAmount(transferAmount, mintQuote);
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
          const prepared = await manager.ops.melt.prepare({
            mintUrl: fromMintUrl,
            method: 'bolt11',
            methodData: { invoice: invoiceToPay },
          });
          updateStepState(id, { operationId: prepared.id });
          {
            const legId = ensureLegId();
            if (groupId && legId && prepared.quoteId) {
              useSwapTransactionsStore.getState().tagMelt(groupId, legId, {
                quoteId: prepared.quoteId,
                operationId: prepared.id,
              });
            }
          }
          return prepared;
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
              mintQuote = await createInvoiceForAmount(transferAmount, mintQuote);
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

              const result = (await manager.ops.melt.execute(preparedMeltOp.id)) as unknown as
                | { state?: string; id?: string }
                | undefined;

              if (result?.state === 'pending') {
                const opId = result.id ?? preparedMeltOp.id;
                const maxWaitMs = 20000;
                const pollIntervalMs = 2000;
                const start = Date.now();

                while (Date.now() - start < maxWaitMs) {
                  const decision = (await manager.ops.melt.refresh(opId)) as unknown as string;
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
                await manager.ops.melt.execute(preparedMeltOp.id);
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
                mintQuote = await createInvoiceForAmount(transferAmount, mintQuote);
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
                  await manager.mint.addMint(url, { trusted: true });
                  temporarilyTrusted.push(url);
                } catch (trustErr) {
                  cashuLog.warn('mint.rebalance.trust_failed', { url, error: trustErr });
                }
              }
            }

            // Insert one visible row per hop immediately (swap-like grouped chain UX)
            const chainId = mintLocalId('chain');
            const autoRouteSteps: TransferStep[] = [];
            for (let i = 0; i < chainPath.length - 1; i++) {
              autoRouteSteps.push({
                ...step,
                id: mintLocalId(`auto-route-${id}-${candidateIdx}-${i}`),
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
                const hopBalances = await manager.wallet.balances.byMint();
                const hopSourceBalance = hopBalances[hopFrom]?.total || 0;

                // ── Per-hop dynamic fee headroom ──
                // Each hop's source mint may have different input_fee_ppk, so
                // compute the headroom specifically for this hop's source mint.
                let hopFeeHeadroom = STATIC_FEE_HEADROOM;
                try {
                  const hopProofs = await getReadyProofs(manager, hopFrom);
                  const hopWallet = await getWallet(manager, hopFrom);
                  const hopInputFee = hopWallet.getFeesForProofs(hopProofs as unknown as Proof[]);
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
                  const hopProbeWallet = await getWallet(manager, hopFrom);
                  const hopProbeQuote = await hopProbeWallet.createMeltQuoteBolt11(hopInvoice);
                  const hopActualFeeReserve = Number(hopProbeQuote.fee_reserve ?? 0);

                  if (hopActualFeeReserve > 0) {
                    // Recompute hop fee headroom with probed fee_reserve
                    let hopProbeInputFee = 0;
                    try {
                      const hpProofs = await getReadyProofs(manager, hopFrom);
                      const hpWallet = await getWallet(manager, hopFrom);
                      hopProbeInputFee = hpWallet.getFeesForProofs(hpProofs as unknown as Proof[]);
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
                  if (hopMq.quoteId) {
                    useSwapTransactionsStore
                      .getState()
                      .tagMintQuote(groupId, hopLegId, hopMq.quoteId);
                  }
                  useSwapTransactionsStore
                    .getState()
                    .setLegStatus(groupId, hopLegId, { localStatus: 'melting' });
                }

                // Prepare melt with retry for "Not enough proofs"
                let hopPrepared: Awaited<ReturnType<typeof manager.ops.melt.prepare>> | null = null;
                let hopTransferAmt = hopAmount;
                for (let att = 0; att <= MAX_PREPARE_RETRIES; att++) {
                  try {
                    hopPrepared = await manager.ops.melt.prepare({
                      mintUrl: hopFrom,
                      method: 'bolt11',
                      methodData: { invoice: hopInvoice },
                    });
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

                if (!hopPrepared) {
                  throw new Error('Failed to prepare hop melt after retries');
                }

                // Execute melt
                updateStepState(hopStepId, { status: 'melting' });
                const hopResult = (await manager.ops.melt.execute(hopPrepared.id)) as unknown as
                  | { state?: string; id?: string }
                  | undefined;

                // Handle pending state
                if (hopResult?.state === 'pending') {
                  const opId = hopResult.id ?? hopPrepared.id;
                  const maxWait = 15000;
                  const start = Date.now();
                  while (Date.now() - start < maxWait) {
                    const dec = (await manager.ops.melt.refresh(opId)) as unknown as string;
                    if (dec === 'finalize') break;
                    if (dec === 'rollback') throw new Error('Hop melt rolled back');
                    await new Promise((r) => setTimeout(r, 2000));
                  }
                }

                // Tag melt in swap store
                if (groupId && hopLegId) {
                  useSwapTransactionsStore.getState().tagMelt(groupId, hopLegId, {
                    quoteId: hopPrepared.quoteId,
                    operationId: hopPrepared.id,
                  });
                  useSwapTransactionsStore.getState().setLegStatus(groupId, hopLegId, {
                    localStatus: 'verifying',
                  });
                }
                updateStepState(hopStepId, {
                  status: 'verifying',
                  operationId: hopPrepared.id,
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

            // Always untrust intermediaries we trusted for this attempt —
            // the trust window must not outlive the operation. Remaining
            // balance is surfaced (not used to retain trust); user can
            // manually re-trust to recover any stranded funds.
            await releaseTemporaryTrust(temporarilyTrusted, finalAutoRouteStepId ?? id);

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
          cashuLog.warn('mint.rebalance.balance_timeout');
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
        // Drive the swap-status store from the same control point that writes
        // updateStepState, so the runner doesn't have to read stepStatesRef
        // across an await (the ref lags one render+commit cycle).
        useSwapStatusStore.getState().setLegDone(id);

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
        useSwapStatusStore.getState().setLegFailed(id, errorMessage);
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
      releaseTemporaryTrust,
    ]
  );

  const runStepsSequentially = useCallback(
    async (steps: TransferStep[], runId: number) => {
      // Span the entire batch so log-doctor's `flows` view shows the wall-clock
      // cost end to end. Per-step timing comes from the appendDebug
      // step_start/step_end pairs already in `executeStep`.
      const batchT0 = performance.now();
      const stepsToRun = steps.filter((s) => {
        const cur = stepStatesRef.current[s.id]?.status;
        return cur !== 'done' && cur !== 'skipped';
      }).length;
      cashuLog.info('swap.batch.start', {
        legCount: stepsToRun,
        totalSteps: steps.length,
        runId,
      });
      let anyFailed = false;
      try {
        for (const step of steps) {
          if (abortRef.current || runIdRef.current !== runId) return;

          const current = stepStatesRef.current[step.id]?.status;
          if (current === 'done' || current === 'skipped') {
            // Pre-completed legs (e.g. retry-failed-only run) — leave the
            // store's pip showing whatever it was before the rerun.
            continue;
          }

          setCurrentStepId(step.id);
          // Flip the SwapStatusToast pip to "active" before kicking the step;
          // executeStep is sync about its UI state but async about coco RPCs.
          useSwapStatusStore.getState().setActiveLeg(step.id);
          const stepT0 = performance.now();
          // executeStep drives setLegDone/Skipped/Failed itself at its terminal
          // sites — see the updateStepState pairs in executeStep — so we don't
          // re-read the React-managed stepStatesRef across this await.
          const ok = await executeStep(step, runId);
          if (!ok) anyFailed = true;
          cashuLog.info('swap.leg.complete', {
            stepId: step.id,
            duration_ms: Math.round(performance.now() - stepT0),
            status: stepStatesRef.current[step.id]?.status,
          });
        }

        if (abortRef.current || runIdRef.current !== runId) return;
        setCurrentStepId(null);
        setRunStatus('finished');
        if (swapGroupIdRef.current) {
          useSwapTransactionsStore.getState().finalizeGroup(swapGroupIdRef.current, 'finished');
        }
        // Read the store fresh — guards retry runs where handleStart's start()
        // wasn't called (no active swap to flip terminal). The store-side
        // actions also early-return on `!active`, so this is double-defence.
        if (useSwapStatusStore.getState().active) {
          if (anyFailed) {
            useSwapStatusStore.getState().fail();
          } else {
            useSwapStatusStore.getState().complete();
          }
        }
      } catch (err) {
        if (useSwapStatusStore.getState().active) {
          useSwapStatusStore.getState().fail(err instanceof Error ? err.message : String(err));
        }
        throw err;
      } finally {
        cashuLog.info('swap.batch.complete', {
          runId,
          duration_ms: Math.round(performance.now() - batchT0),
          aborted: abortRef.current,
        });
        // Always reset the running ref when done
        isRunningRef.current = false;
      }
    },
    [executeStep]
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

    // Wire the unified Swap status toast — `usePaymentStatusListener` reads
    // `useSwapStatusStore.active` and skips per-op toasts while this is
    // running, so the user sees one progress notification instead of N.
    const totalAmount = snapshot.steps.reduce((sum, s) => sum + (s.amount ?? 0), 0);
    useSwapStatusStore.getState().start({
      id: `swap-${runId}-${Date.now()}`,
      unit,
      totalAmount,
      // Backs the toast's "View" button so completion → tap → SwapTransactionScreen.
      groupId: swapGroupIdRef.current ?? undefined,
      legs: snapshot.steps.map((s) => ({
        id: s.id,
        label: `${extractDomain(s.fromMintUrl)} → ${extractDomain(s.toMintUrl)}`,
      })),
    });
    swapStatusPopup();

    // Kick off the runner (do not await; keep UI responsive)
    // Use the snapshot steps (stable), not any live recomputed list.
    runStepsSequentially(snapshot.steps, runId);
  }, [computedPlan, runStatus, runStepsSequentially, unit]);

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

  const handleSkip = useCallback(
    (step: TransferStep) => {
      if (runStatus === 'running') return;
      updateStepState(step.id, { status: 'skipped' });
    },
    [updateStepState, runStatus]
  );

  const handleDone = useCallback(() => {
    router.dismissTo('/');
  }, []);

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
            await manager.mint.addMint(url, { trusted: true });
            temporarilyTrusted.push(url);
          } catch (err) {
            cashuLog.warn('mint.rebalance.trust_failed', { url, error: err });
          }
        }
      }

      const afterId = step.id;
      const chainId = mintLocalId('chain');

      // Create one TransferStep per hop in the path
      const rerouteSteps: TransferStep[] = [];
      for (let i = 0; i < chainPath.length - 1; i++) {
        rerouteSteps.push({
          ...step,
          id: mintLocalId(`reroute-${afterId}-${i}`),
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
        // Always revoke temporary trust we acquired for intermediaries — the
        // trust window must not outlive the operation. If funds remain on an
        // intermediary after a mid-chain failure, surface that to the user via
        // the step's routingDetail and a louder log; the mint URL stays in the
        // wallet (untrust does not delete proofs), and the user can re-trust
        // manually to recover.
        await releaseTemporaryTrust(temporarilyTrusted, rerouteSteps[rerouteSteps.length - 1]?.id);
      }
    },
    [runPlan, runStatus, runStepsSequentially, trustedMints, manager, releaseTemporaryTrust]
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
    // Flip the SwapStatusToast to its terminal 'cancelled' state. Without this
    // the toast sits on 'Swapping' until the in-flight melt resolves on its
    // own — the runner's tail at runStepsSequentially returns early on
    // abortRef so its complete()/fail() never fires either.
    useSwapStatusStore.getState().cancel();
  }, []);

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

    if (runStatus === 'finished' || stepCounts.allComplete) {
      return (
        <BottomButtons>
          <ButtonHandler
            buttons={[
              {
                text: 'Done',
                variant: 'primary' as const,
                onPress: async () => handleDone(),
              },
              ...(stepCounts.hasFailedStep
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
              disabled: stepCounts.executing && runStatus === 'running',
            },
          ]}
        />
      </BottomButtons>
    );
  }, [
    alreadyBalanced,
    plan.steps,
    stepCounts,
    runStatus,
    handleDone,
    handleStart,
    handleRetryFailed,
    handleCancelRun,
  ]);

  return (
    <Screen
      name="MintRebalancePlanScreen"
      footer={bottomButtons}
      contentPadding={0}
      bgColor={background}>
      <Stack.Screen
        options={{
          title: 'Rebalance Plan',
          headerRight: () => null,
        }}
      />

      <View className="mx-4 my-2 rounded-2xl p-4" style={{ backgroundColor: surfaceSecondary }}>
        <VStack gap={8}>
          {runPlan && (
            <View
              className="h-1.5 overflow-hidden rounded-full"
              style={{ backgroundColor: surfaceTertiary }}>
              <View
                className="h-1.5 rounded-full"
                style={{
                  width: `${stepCounts.progressPct * 100}%`,
                  backgroundColor: stepCounts.failed > 0 ? danger : green400,
                }}
              />
            </View>
          )}
          <HStack justify="space-between" align="center">
            <Text size={14} style={{ color: fgMuted }}>
              Total to move
            </Text>
            <AmountFormatter
              amount={plan.totalAmount}
              unit={unit}
              size={18}
              weight="heavy"
              color={foreground}
            />
          </HStack>
          <HStack justify="space-between" align="center">
            <Text size={14} style={{ color: fgMuted }}>
              Steps
            </Text>
            <Text bold size={18} style={{ color: foreground }}>
              {stepCounts.completed}/{plan.steps.length}
            </Text>
          </HStack>
          {runPlan && stepCounts.skipped > 0 && (
            <HStack justify="space-between" align="center">
              <Text size={14} style={{ color: fgMuted }}>
                Skipped
              </Text>
              <Text bold size={18} style={{ color: fgDim }}>
                {stepCounts.skipped}
              </Text>
            </HStack>
          )}
          {runPlan && (
            <HStack justify="space-between" align="center">
              <Text size={14} style={{ color: fgMuted }}>
                Errors
              </Text>
              <Text bold size={18} style={{ color: stepCounts.failed > 0 ? danger : foreground }}>
                {stepCounts.failed}
              </Text>
            </HStack>
          )}
          <Text size={11} style={{ color: fgDim }}>
            Transfers under {minTransferThreshold} sats are ignored
          </Text>
        </VStack>
      </View>

      {alreadyBalanced && (
        <View className="items-center p-10">
          <VStack gap={12} align="center">
            <Icon name="mdi:check-circle" size={48} color={green400} />
            <Text size={16} style={{ color: foreground, textAlign: 'center' }}>
              Already balanced!
            </Text>
            <Text size={14} style={{ color: fgMuted, textAlign: 'center' }}>
              Your current balances match the desired distribution.
            </Text>
          </VStack>
        </View>
      )}

      {!alreadyBalanced && plan.steps.length === 0 && (
        <View className="items-center p-10">
          <VStack gap={12} align="center">
            <Icon name="mdi:check-circle" size={48} color={green400} />
            <Text size={16} style={{ color: foreground, textAlign: 'center' }}>
              No transfers needed
            </Text>
            <Text size={14} style={{ color: fgMuted, textAlign: 'center' }}>
              All differences are below the {minTransferThreshold} sat threshold.
            </Text>
          </VStack>
        </View>
      )}

      {plan.steps.length > 0 && (
        <Animated.View layout={LinearTransition.duration(280)}>
          <VStack gap={0} className="pt-2">
            {groupStepsForDisplay(plan.steps, runPlan ? stepStates : {}).map((group) => {
              if (group.chainId && group.steps.length > 1) {
                return (
                  <RebalanceChainCard
                    key={group.id}
                    group={group}
                    stepStates={runPlan ? stepStates : {}}
                    mintInfoMap={mintInfoMap}
                    unit={unit}
                    isRunning={runStatus === 'running'}
                    onRetry={handleRetry}
                    onSkip={handleSkip}
                  />
                );
              }

              const step = group.steps[0];
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
        </Animated.View>
      )}

      {runStatus === 'finished' && plan.steps.length > 0 && swapGroupIdRef.current && (
        <View className="px-4 pb-2 pt-3">
          <Pressable
            haptics
            onPress={() => {
              router.navigate({
                pathname: '/swap',
                params: { groupId: swapGroupIdRef.current! },
              });
            }}>
            <View
              className="overflow-hidden rounded-[20px] border"
              style={{ borderColor: surfaceTertiary, borderCurve: 'continuous' as any }}>
              <BlurCardFrame accentColor={fgMuted}>
                <View className="z-[1] items-center p-3">
                  <Text size={14} bold style={{ color: foreground }}>
                    View Swap
                  </Text>
                </View>
              </BlurCardFrame>
            </View>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}
