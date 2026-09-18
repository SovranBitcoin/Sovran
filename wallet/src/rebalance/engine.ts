// ---------------------------------------------------------------------------
// Rebalance engine — moves funds between mints over Lightning
//
// One transfer mints an invoice on the destination and melts proofs on the
// source to pay it. When Lightning finds no route, the engine retries through
// middleman mints, one hop at a time. The engine owns:
//
// - amount decisions (fee headroom, probed fee reserve, capping);
// - bounded re-preparation: a melt that has not paid is re-prepared with a
//   slightly smaller invoice when proofs or inputs fall short;
// - reconciliation: a melt that was sent is never sent again — its outcome is
//   read back from coco, and an unknown outcome stays `pending`;
// - hop sequencing, temporary trust of intermediaries, and recipient checks.
//
// Wallet access, route discovery, progress reporting, time and logging are
// injected, so the engine runs the same under tests and in the app.
// ---------------------------------------------------------------------------

import { amountToNumber } from '../balance';
import { logger as packageLogger, mintUrlFields, errField } from '../logger';
import {
  computeInitialTransferAmount,
  feeHeadroomFor,
  recapForProbedHeadroom,
  staticFeeHeadroom,
  toWholeSats,
} from './amounts';
import {
  classifyRebalanceError,
  RebalanceMeltRolledBackError,
  RebalanceRoutesExhaustedError,
} from './errors';
import { defaultRebalanceClock } from './lock';
import type {
  RebalanceEngineConfig,
  RebalanceEventSink,
  RebalanceMintReceipt,
  RebalanceMintSnapshot,
  RebalancePreparedMelt,
  RebalanceRoute,
  RebalanceRunCallbacks,
  RebalanceRunResult,
  RebalanceTransfer,
  RebalanceTransferOutcome,
} from './types';

/** Re-preparations allowed when proof selection falls short. */
const MAX_PREPARE_RETRIES = 5;
/** Re-preparations allowed when the mint rejects the melt inputs. */
const MAX_EXECUTE_RETRIES = 2;
/** Sats removed from the invoice per re-preparation. */
const RETRY_REDUCE_SATS = 2;
const DIRECT_SETTLE_WAIT_MS = 20_000;
const HOP_SETTLE_WAIT_MS = 15_000;
const SETTLE_POLL_MS = 2_000;
const INTERMEDIATE_RECEIPT_WAIT_MS = 12_000;
const FINAL_RECEIPT_WAIT_MS = 15_000;
const RECEIPT_POLL_MS = 1_000;
const NEXT_ROUTE_PAUSE_MS = 1_500;
const NEXT_TRANSFER_PAUSE_MS = 500;

/** Melt states in which the payment may already have left the mint. */
const MELT_IN_FLIGHT_STATES = new Set(['executing', 'pending', 'finalized']);

type Settlement = 'finalized' | 'pending' | 'aborted';

interface TransferRun {
  step: RebalanceTransfer;
  isActive: () => boolean;
  sink: RebalanceEventSink;
  /** Mints holding a melt whose outcome is unknown; their proofs are never restored. */
  unsettledMints: Set<string>;
}

type ChainResult =
  | { status: 'complete'; finalHopLegId: string; finalReceipt: RebalanceMintReceipt }
  | { status: 'incomplete'; finalHopLegId?: string; error?: unknown };

type HopResult =
  | { status: 'sent'; receipt: RebalanceMintReceipt }
  | { status: 'insufficient' }
  | { status: 'aborted' };

export interface RebalanceEngine {
  /** Run one transfer to a terminal outcome. Never throws for wallet failures. */
  executeTransfer(
    step: RebalanceTransfer,
    options: { isActive: () => boolean; sink: RebalanceEventSink }
  ): Promise<RebalanceTransferOutcome>;
  /** Run transfers in order, skipping those already settled. */
  runTransfers(
    steps: readonly RebalanceTransfer[],
    callbacks: RebalanceRunCallbacks
  ): Promise<RebalanceRunResult>;
  /**
   * Trust the untrusted intermediaries of `chainPath` for the duration of
   * `run`, then untrust them whatever happens. Balances left on them are
   * reported on `warnLegId`.
   */
  withTemporaryTrust<T>(
    chainPath: readonly string[],
    report: { sink: Pick<RebalanceEventSink, 'legUpdated'>; warnLegId?: string },
    run: () => Promise<T>
  ): Promise<T>;
}

export function createRebalanceEngine(config: RebalanceEngineConfig): RebalanceEngine {
  const { wallet, lock, minTransferThreshold, minFeeReserve } = config;
  const clock = config.clock ?? defaultRebalanceClock;
  const log = config.logger ?? packageLogger;
  const debug = (entry: Record<string, unknown>) => log.debug('mint.rebalance.step', entry);

  // ── Wallet reads with documented fallbacks ────────────────────────────

  async function readWorstCaseInputFee(mintUrl: string): Promise<number | null> {
    try {
      return await wallet.worstCaseInputFee(mintUrl);
    } catch (error) {
      // Best-effort: the static headroom applies instead, and bounded
      // re-preparation absorbs any remaining shortfall.
      log.debug('mint.rebalance.input_fee_unavailable', { ...mintUrlFields(mintUrl), error });
      return null;
    }
  }

  async function probeFeeReserve(mintUrl: string, invoice: string): Promise<number | null> {
    try {
      return await wallet.probeMeltFeeReserve(mintUrl, invoice);
    } catch (error) {
      // Best-effort: keep the current headroom estimate; bounded
      // re-preparation absorbs any remaining shortfall.
      log.debug('mint.rebalance.melt_probe_failed', { ...mintUrlFields(mintUrl), error });
      return null;
    }
  }

  async function restoreInflight(run: TransferRun, mintUrl: string): Promise<void> {
    if (run.unsettledMints.has(mintUrl)) {
      // A melt from this mint may still pay; its proofs must stay reserved.
      log.warn('mint.rebalance.restore_skipped_unsettled_melt', { ...mintUrlFields(mintUrl) });
      return;
    }
    await wallet.restoreInflightProofs(mintUrl);
  }

  // ── Reconciliation ────────────────────────────────────────────────────

  /** Poll a sent melt until coco reports it settled, it rolls back, or time runs out. */
  async function awaitMeltSettlement(
    operationId: string,
    maxWaitMs: number,
    isActive: () => boolean,
    rolledBackMessage?: string
  ): Promise<Settlement> {
    const start = clock.now();
    while (clock.now() - start < maxWaitMs) {
      if (!isActive()) return 'aborted';
      const refreshed = await wallet.refreshMelt(operationId);
      if (refreshed.state === 'finalized') return 'finalized';
      if (refreshed.state === 'rolled_back') {
        throw new RebalanceMeltRolledBackError(operationId, rolledBackMessage);
      }
      await clock.sleep(SETTLE_POLL_MS);
    }
    return 'pending';
  }

  /** Read the melt's persisted state after `execute` threw; null when it cannot be read. */
  async function readMeltState(operationId: string): Promise<string | null> {
    try {
      return (await wallet.getMeltOperation(operationId))?.state ?? null;
    } catch (error) {
      // An unreadable state falls back to the error's own classification.
      log.warn('mint.rebalance.melt_state_read_failed', { operationId, error });
      return null;
    }
  }

  /**
   * Execute a prepared melt once and report how it settled. When `execute`
   * throws, the melt is reconciled against coco's state before the error is
   * believed: a melt that is in flight is awaited, never repeated.
   */
  async function executeMeltOnce(
    run: TransferRun,
    melt: RebalancePreparedMelt,
    mintUrl: string,
    settleWaitMs: number,
    rolledBackMessage?: string
  ): Promise<Settlement> {
    const settle = async (operationId: string): Promise<Settlement> => {
      run.unsettledMints.add(mintUrl);
      let settlement: Settlement;
      try {
        settlement = await awaitMeltSettlement(
          operationId,
          settleWaitMs,
          run.isActive,
          rolledBackMessage
        );
      } catch (error) {
        // Rolled back: the mint released the inputs, so the mint is settled.
        run.unsettledMints.delete(mintUrl);
        throw error;
      }
      if (settlement === 'finalized') run.unsettledMints.delete(mintUrl);
      return settlement;
    };

    let result: Awaited<ReturnType<typeof wallet.executeMelt>>;
    try {
      result = await wallet.executeMelt(melt.id);
    } catch (error) {
      if (!run.isActive()) return 'aborted';
      if (classifyRebalanceError(error) === 'operation_in_progress') {
        debug({ event: 'melt_in_progress_reconcile', stepId: run.step.id, operationId: melt.id });
        return settle(melt.id);
      }
      const state = await readMeltState(melt.id);
      if (state !== null && MELT_IN_FLIGHT_STATES.has(state)) {
        debug({ event: 'melt_error_in_flight', stepId: run.step.id, operationId: melt.id, state });
        return settle(melt.id);
      }
      throw error;
    }
    if (!run.isActive()) return 'aborted';
    if (result?.state === 'pending') return settle(result.id ?? melt.id);
    return 'finalized';
  }

  function isCleanFinalization(
    operation: RebalanceMintSnapshot | null,
    expected: RebalanceMintReceipt
  ): boolean {
    // Coco can finalize ALREADY_ISSUED with an error when proofs could not be
    // restored. Only a clean finalization of this exact receipt confirms it.
    return (
      operation?.id === expected.id &&
      operation.mintUrl === expected.mintUrl &&
      operation.quoteId === expected.quoteId &&
      operation.method === expected.method &&
      operation.unit === expected.unit &&
      operation.amount.equals(expected.amount) &&
      operation.state === 'finalized' &&
      !operation.error
    );
  }

  /** Wait for this transfer's own recipient operation, never an unrelated deposit. */
  async function waitForReceipt(
    expected: RebalanceMintReceipt,
    maxWaitMs: number,
    isActive: () => boolean
  ): Promise<boolean> {
    const deadline = clock.now() + maxWaitMs;
    while (isActive() && clock.now() < deadline) {
      let operation: RebalanceMintSnapshot | null = null;
      try {
        operation = await wallet.getMintOperation(expected.id);
      } catch (error) {
        // A read is idempotent; the next poll tries again until the deadline.
        log.warn('mint.rebalance.recipient_operation_read_failed', {
          ...mintUrlFields(expected.mintUrl),
          operationId: expected.id,
          error,
        });
      }
      if (!isActive()) return false;
      if (isCleanFinalization(operation, expected)) return true;
      await clock.sleep(Math.min(RECEIPT_POLL_MS, Math.max(0, deadline - clock.now())));
    }
    return false;
  }

  // ── Preparation ───────────────────────────────────────────────────────

  /**
   * Prepare a melt, shrinking the invoice when proof selection falls short.
   * Preparation sends nothing to the mint, so a re-preparation repeats no
   * side effect.
   */
  async function prepareWithShrinkingAmount(options: {
    stepId: string;
    amount: number;
    invoice: string;
    prepare: (invoice: string) => Promise<RebalancePreparedMelt>;
    reissue: (amount: number) => Promise<string>;
  }): Promise<{ prepared: RebalancePreparedMelt; amount: number; invoice: string }> {
    let { amount, invoice } = options;
    for (let attempt = 0; ; attempt++) {
      try {
        return { prepared: await options.prepare(invoice), amount, invoice };
      } catch (error) {
        const shortfall = classifyRebalanceError(error) === 'insufficient_proofs';
        if (!shortfall || attempt >= MAX_PREPARE_RETRIES) throw error;
        amount -= RETRY_REDUCE_SATS;
        if (amount < minTransferThreshold) throw error;
        debug({
          event: 'prepare_retry',
          stepId: options.stepId,
          attempt: attempt + 1,
          reducedAmount: amount,
          reason: errField(error),
        });
        invoice = await options.reissue(amount);
      }
    }
  }

  // ── Temporary trust ───────────────────────────────────────────────────

  async function trustIntermediaries(chainPath: readonly string[]): Promise<string[]> {
    const temporarilyTrusted: string[] = [];
    for (const url of chainPath.slice(1, -1)) {
      if (config.trustedMintUrls.has(url)) continue;
      try {
        await wallet.trustMint(url);
        temporarilyTrusted.push(url);
      } catch (error) {
        // The route still runs; a hop through a mint coco refuses fails on
        // its own and the next candidate is tried.
        log.warn('mint.rebalance.trust_failed', { ...mintUrlFields(url), error });
      }
    }
    return temporarilyTrusted;
  }

  async function releaseTrust(
    temporarilyTrusted: readonly string[],
    report: { sink: Pick<RebalanceEventSink, 'legUpdated'>; warnLegId?: string }
  ): Promise<void> {
    const { stranded, untrustErrors } = await wallet.releaseTrust(temporarilyTrusted);
    for (const { url, error } of untrustErrors) {
      log.warn('mint.rebalance.untrust_failed', { ...mintUrlFields(url), error });
    }
    if (stranded.length === 0) return;
    // Funds remain on an intermediary the user did not pre-trust: recovery
    // requires the user to re-trust it.
    log.warn('mint.rebalance.middleman_recovery_required', {
      strandedCount: stranded.length,
      strandedMintUrlLengths: stranded.map((item) => item.url.length),
    });
    if (report.warnLegId) {
      report.sink.legUpdated(report.warnLegId, { routing: { kind: 'stranded', stranded } });
    }
  }

  async function withTemporaryTrust<T>(
    chainPath: readonly string[],
    report: { sink: Pick<RebalanceEventSink, 'legUpdated'>; warnLegId?: string },
    runWithTrust: () => Promise<T>
  ): Promise<T> {
    const temporarilyTrusted = await trustIntermediaries(chainPath);
    try {
      return await runWithTrust();
    } finally {
      // The trust window must not outlive the operation.
      await releaseTrust(temporarilyTrusted, report);
    }
  }

  // ── Middleman hops ────────────────────────────────────────────────────

  async function runHop(
    run: TransferRun,
    hop: {
      legId: string;
      index: number;
      path: string[];
      chainId: string;
      firstHopCap: number;
    }
  ): Promise<HopResult> {
    const { sink, isActive } = run;
    const stepId = run.step.id;
    const hopFrom = hop.path[hop.index];
    const hopTo = hop.path[hop.index + 1];
    const hopCount = hop.path.length - 1;
    sink.legUpdated(hop.legId, {
      status: 'creatingInvoice',
      error: null,
      routing: {
        kind: 'hop',
        hopIndex: hop.index,
        hopCount,
        fromMintUrl: hopFrom,
        toMintUrl: hopTo,
      },
    });

    const hopSourceBalance = (await wallet.balancesByMint())[hopFrom] ?? 0;
    // Each hop's source may charge a different input_fee_ppk.
    const hopInputFee = await readWorstCaseInputFee(hopFrom);
    const hopFeeHeadroom =
      hopInputFee === null
        ? staticFeeHeadroom(minFeeReserve)
        : feeHeadroomFor(minFeeReserve, hopInputFee);
    // The first hop carries the transfer; later hops forward what landed.
    let hopAmount =
      hop.index === 0
        ? (toWholeSats(Math.min(hop.firstHopCap, hopSourceBalance - hopFeeHeadroom)) ?? 0)
        : (toWholeSats(hopSourceBalance - hopFeeHeadroom) ?? 0);

    if (hopAmount < minTransferThreshold) {
      debug({
        event: 'chain_hop_insufficient',
        stepId,
        hopIdx: hop.index,
        hopAmount,
        hopSourceBalance,
      });
      return { status: 'insufficient' };
    }
    debug({
      event: 'chain_hop_start',
      stepId,
      hopIdx: hop.index,
      hopAmount,
      hopSourceBalance,
    });

    let receipt = await wallet.createMintReceipt(hopTo, hopAmount);
    sink.legUpdated(hop.legId, { status: 'invoiceReady', invoice: receipt.request });

    const probedReserve = await probeFeeReserve(hopFrom, receipt.request);
    if (probedReserve !== null && probedReserve > 0) {
      const probedHeadroom = probedReserve + ((await readWorstCaseInputFee(hopFrom)) ?? 0);
      const capped = recapForProbedHeadroom({
        amount: hopAmount,
        sourceBalance: hopSourceBalance,
        headroom: probedHeadroom,
        minTransferThreshold,
      });
      if (capped !== null) {
        debug({
          event: 'hop_amount_recapped_after_probe',
          stepId,
          hopIdx: hop.index,
          original: hopAmount,
          capped,
          hopSourceBalance,
          hopProbedHeadroom: probedHeadroom,
        });
        hopAmount = capped;
        receipt = await wallet.createMintReceipt(hopTo, hopAmount);
        sink.legUpdated(hop.legId, { status: 'invoiceReady', invoice: receipt.request });
      }
    }

    sink.legOpened(hop.legId, {
      fromMintUrl: hopFrom,
      toMintUrl: hopTo,
      amount: hopAmount,
      chainId: hop.chainId,
      chainPath: hop.path,
      chainHopIndex: hop.index,
    });
    sink.mintReceiptCreated(hop.legId, receipt);

    const { prepared, amount: hopTransferAmount } = await prepareWithShrinkingAmount({
      stepId,
      amount: hopAmount,
      invoice: receipt.request,
      prepare: (invoice) => wallet.prepareMelt(hopFrom, invoice),
      reissue: async (amount) => {
        receipt = await wallet.createMintReceipt(hopTo, amount);
        sink.mintReceiptCreated(hop.legId, receipt);
        sink.legUpdated(hop.legId, { status: 'invoiceReady', invoice: receipt.request });
        return receipt.request;
      },
    });

    sink.legUpdated(hop.legId, { status: 'melting' });
    // An unsettled hop still proceeds: the next hop reconciles through the
    // intermediary's balance and the recipient operation check.
    const settlement = await executeMeltOnce(
      run,
      prepared,
      hopFrom,
      HOP_SETTLE_WAIT_MS,
      'Hop melt rolled back'
    );
    if (settlement === 'aborted' || !isActive()) return { status: 'aborted' };

    sink.meltPrepared(hop.legId, prepared);
    sink.legUpdated(hop.legId, { status: 'verifying', operationId: prepared.id });
    debug({
      event: 'chain_hop_done',
      stepId,
      hopIdx: hop.index,
      amount: hopTransferAmount,
    });
    return { status: 'sent', receipt };
  }

  async function runChain(
    run: TransferRun,
    attempt: {
      route: RebalanceRoute;
      index: number;
      chainId: string;
      hopLegIds: string[];
      transferAmount: number;
    }
  ): Promise<ChainResult> {
    const { route, hopLegIds } = attempt;
    const hopCount = route.path.length - 1;
    let finalHopLegId: string | undefined;
    let startedHops = 0;
    try {
      let finalReceipt: RebalanceMintReceipt | null = null;
      for (let index = 0; index < hopCount; index++) {
        if (!run.isActive()) return { status: 'incomplete', finalHopLegId };
        const legId = hopLegIds[index];
        finalHopLegId = legId;
        startedHops = index + 1;
        const hop = await runHop(run, {
          legId,
          index,
          path: route.path,
          chainId: attempt.chainId,
          firstHopCap: attempt.transferAmount,
        });
        if (hop.status !== 'sent') return { status: 'incomplete', finalHopLegId };
        finalReceipt = hop.receipt;
        if (index < hopCount - 1) {
          // Wait for this hop's recipient operation before the next hop spends it.
          await waitForReceipt(hop.receipt, INTERMEDIATE_RECEIPT_WAIT_MS, run.isActive);
          if (!run.isActive()) return { status: 'incomplete', finalHopLegId };
          run.sink.legUpdated(legId, { status: 'done', routing: null });
        }
      }
      if (!finalReceipt || !finalHopLegId) return { status: 'incomplete', finalHopLegId };
      return { status: 'complete', finalHopLegId, finalReceipt };
    } catch (error) {
      debug({
        event: 'chain_candidate_error',
        stepId: run.step.id,
        candidateIdx: attempt.index,
        error: errField(error),
      });
      // Free proofs reserved by the failed hop on every mint of the route so
      // the next candidate can use them (mints with an unsettled melt excepted).
      for (const url of route.path) await restoreInflight(run, url);
      if (finalHopLegId) run.sink.legUpdated(finalHopLegId, { status: 'failed', error });
      for (const legId of hopLegIds.slice(startedHops)) {
        run.sink.legUpdated(legId, { status: 'skipped' });
      }
      return { status: 'incomplete', finalHopLegId, error };
    }
  }

  /**
   * Retry a no-route transfer through each candidate middleman route in turn.
   * Returns the final hop's leg and receipt, or throws the last route error.
   */
  async function routeThroughMiddlemen(
    run: TransferRun,
    noRouteError: unknown,
    transferAmount: number
  ): Promise<{ finalHopLegId: string; finalReceipt: RebalanceMintReceipt } | 'aborted'> {
    const { step, sink } = run;
    const { id, fromMintUrl, toMintUrl } = step;
    debug({ event: 'no_route_auto_routing', stepId: id });
    sink.legUpdated(id, { status: 'routing', error: null, routing: { kind: 'searching' } });

    // The melt found no route, so it never paid; free its proofs for the chain.
    await restoreInflight(run, fromMintUrl);

    const routes = await config.findRoutes(fromMintUrl, toMintUrl);
    debug({
      event: 'routing_candidates',
      stepId: id,
      candidateCount: routes.length,
      candidates: routes.map((route) => ({ pathLength: route.path.length, source: route.source })),
    });
    if (routes.length === 0) {
      debug({ event: 'no_route_no_middleman', stepId: id });
      throw noRouteError;
    }

    let lastError: unknown = noRouteError;
    for (let index = 0; index < routes.length; index++) {
      if (!run.isActive()) return 'aborted';
      const route = routes[index];
      debug({
        event: 'trying_candidate_route',
        stepId: id,
        candidateIdx: index,
        candidateCount: routes.length,
        pathLength: route.path.length,
        source: route.source,
      });
      sink.legUpdated(id, {
        routing: {
          kind: 'candidate',
          index,
          count: routes.length,
          path: route.path,
          pathNames: route.pathNames,
        },
      });

      const temporarilyTrusted = await trustIntermediaries(route.path);
      const { chainId, hopLegIds } = sink.routeAttemptStarted(id, {
        route,
        index,
        count: routes.length,
      });
      const result = await runChain(run, { route, index, chainId, hopLegIds, transferAmount });
      await releaseTrust(temporarilyTrusted, { sink, warnLegId: result.finalHopLegId ?? id });
      if (!run.isActive()) return 'aborted';

      if (result.status === 'complete') {
        debug({ event: 'auto_route_chain_complete', stepId: id, candidateIdx: index });
        return result;
      }
      if (result.error !== undefined) lastError = result.error;
      debug({
        event: 'candidate_route_failed_trying_next',
        stepId: id,
        candidateIdx: index,
        remainingCandidates: routes.length - index - 1,
      });
      // Give coco a moment to settle before the next candidate.
      await clock.sleep(NEXT_ROUTE_PAUSE_MS);
    }
    if (!run.isActive()) return 'aborted';
    throw routes.length > 1
      ? new RebalanceRoutesExhaustedError(routes.length, { cause: lastError })
      : lastError;
  }

  // ── Direct transfer ───────────────────────────────────────────────────

  async function transfer(run: TransferRun): Promise<RebalanceTransferOutcome> {
    const { step, sink, isActive } = run;
    const { id, fromMintUrl, toMintUrl, amount: originalAmount } = step;
    debug({
      event: 'step_start',
      stepId: id,
      amount: originalAmount,
      chainId: step.chainId,
      chainHopIndex: step.chainHopIndex,
    });

    try {
      const sourceBalance = (await wallet.balancesByMint())[fromMintUrl] ?? 0;
      debug({ event: 'balances_fetched', stepId: id, sourceBalance });

      // Fee headroom from the source's real proof set: with fragmented proofs
      // and per-proof input fees a static headroom is far too small.
      const worstCaseInputFee = await readWorstCaseInputFee(fromMintUrl);
      let feeHeadroom =
        worstCaseInputFee === null
          ? staticFeeHeadroom(minFeeReserve)
          : feeHeadroomFor(minFeeReserve, worstCaseInputFee);
      if (worstCaseInputFee !== null) {
        debug({
          event: 'fee_headroom_computed',
          stepId: id,
          inputFee: worstCaseInputFee,
          feeHeadroom,
        });
      }

      const decision = computeInitialTransferAmount({
        requestedAmount: originalAmount,
        sourceBalance,
        minTransferThreshold,
        feeHeadroom,
      });
      if (decision.status === 'skip') {
        // Commonly a prior step's middleman route already swept this mint.
        debug({
          event: 'step_skipped_low_balance',
          stepId: id,
          sourceBalance,
          minRequired: decision.minRequired,
        });
        sink.legUpdated(id, { status: 'skipped' });
        return { status: 'skipped' };
      }

      sink.legOpened(id, {
        fromMintUrl,
        toMintUrl,
        amount: originalAmount,
        ...(step.chainId && {
          chainId: step.chainId,
          chainPath: step.chainPath,
          chainHopIndex: step.chainHopIndex,
        }),
      });
      sink.legUpdated(id, { status: 'creatingInvoice', error: null });

      let transferAmount = decision.amount;
      if (decision.status === 'capped') {
        debug({
          event: 'amount_capped',
          stepId: id,
          original: originalAmount,
          capped: transferAmount,
          sourceBalance,
          feeHeadroom,
        });
      }

      // A replaced receipt stays open on the destination until it expires;
      // logging its id keeps the orphan observable.
      const issueReceipt = async (amount: number, previous?: RebalanceMintReceipt) => {
        if (previous?.quoteId) {
          debug({
            event: 'mint_quote_orphaned',
            stepId: id,
            orphanedQuoteId: previous.quoteId,
            reason: 'amount_changed',
          });
        }
        const next = await wallet.createMintReceipt(toMintUrl, amount);
        sink.mintReceiptCreated(id, next);
        return next;
      };

      let receipt = await issueReceipt(transferAmount);

      // The mint's fee reserve varies widely; a read-only quote reveals it
      // so the amount is capped up front instead of by blind retries.
      const probedReserve = await probeFeeReserve(fromMintUrl, receipt.request);
      if (probedReserve !== null && probedReserve > 0) {
        const probedHeadroom = probedReserve + (worstCaseInputFee ?? 0);
        debug({
          event: 'melt_probe_result',
          stepId: id,
          actualFeeReserve: probedReserve,
          worstCaseInputFee,
          probedHeadroom,
          previousHeadroom: feeHeadroom,
        });
        feeHeadroom = Math.max(feeHeadroom, probedHeadroom);
        const capped = recapForProbedHeadroom({
          amount: transferAmount,
          sourceBalance,
          headroom: feeHeadroom,
          minTransferThreshold,
        });
        if (capped !== null) {
          debug({
            event: 'amount_recapped_after_probe',
            stepId: id,
            original: transferAmount,
            capped,
            sourceBalance,
            feeHeadroom,
          });
          transferAmount = capped;
          receipt = await issueReceipt(transferAmount, receipt);
        }
      }

      sink.legUpdated(id, { status: 'invoiceReady', invoice: receipt.request });

      const prepareForInvoice = async (invoice: string) => {
        const prepared = await wallet.prepareMelt(fromMintUrl, invoice);
        sink.meltPrepared(id, prepared);
        return prepared;
      };
      const reissue = async (amount: number) => {
        receipt = await issueReceipt(amount, receipt);
        sink.legUpdated(id, { status: 'invoiceReady', invoice: receipt.request });
        return receipt.request;
      };

      const initial = await prepareWithShrinkingAmount({
        stepId: id,
        amount: transferAmount,
        invoice: receipt.request,
        prepare: prepareForInvoice,
        reissue,
      });
      transferAmount = initial.amount;
      let invoice = initial.invoice;
      let prepared: RebalancePreparedMelt | null = initial.prepared;
      debug({
        event: 'melt_prepared',
        stepId: id,
        operationId: initial.prepared.id,
        invoiceAmount: amountToNumber(initial.prepared.amount ?? transferAmount),
        feeReserve: amountToNumber(initial.prepared.fee_reserve),
        swapFee: amountToNumber(initial.prepared.swap_fee),
        sourceBalance,
      });

      sink.legUpdated(id, { status: 'melting' });

      let finalHopLegId: string | null = null;
      let finalReceipt: RebalanceMintReceipt = receipt;
      try {
        for (let attempt = 0; ; attempt++) {
          const melt: RebalancePreparedMelt = prepared ?? (await prepareForInvoice(invoice));
          prepared = melt;
          try {
            const settlement = await executeMeltOnce(run, melt, fromMintUrl, DIRECT_SETTLE_WAIT_MS);
            if (settlement === 'aborted' || !isActive()) return { status: 'aborted' };
            if (settlement === 'pending') {
              log.warn('mint.rebalance.melt_pending_unresolved', { stepId: id, operationId: melt.id });
              sink.legUpdated(id, { status: 'paymentPending', routing: null });
              return { status: 'pending', operationId: melt.id };
            }
            finalReceipt = receipt;
            break;
          } catch (error) {
            // `executeMeltOnce` already confirmed the melt is not in flight,
            // so the mint rejected its inputs before paying anything.
            const shortfall = classifyRebalanceError(error) === 'input_shortfall';
            if (!shortfall || attempt >= MAX_EXECUTE_RETRIES) throw error;
            transferAmount -= RETRY_REDUCE_SATS;
            if (transferAmount < minTransferThreshold) throw error;
            debug({
              event: 'execute_input_retry',
              stepId: id,
              attempt: attempt + 1,
              reducedAmount: transferAmount,
              reason: errField(error),
            });
            await restoreInflight(run, fromMintUrl);
            invoice = await reissue(transferAmount);
            prepared = null;
          }
        }
      } catch (meltError) {
        if (!isActive()) return { status: 'aborted' };
        if (classifyRebalanceError(meltError) !== 'no_route') throw meltError;
        const routed = await routeThroughMiddlemen(run, meltError, transferAmount);
        if (routed === 'aborted') return { status: 'aborted' };
        finalHopLegId = routed.finalHopLegId;
        finalReceipt = routed.finalReceipt;
      }

      // Coco's background processor claims the paid quote; confirm this
      // transfer's own recipient operation.
      const verifyingLegId = finalHopLegId ?? id;
      sink.legUpdated(verifyingLegId, { status: 'verifying', routing: null });
      const recipientFinalized = await waitForReceipt(
        finalReceipt,
        FINAL_RECEIPT_WAIT_MS,
        isActive
      );
      if (!isActive()) return { status: 'aborted' };
      if (!recipientFinalized) {
        // The melt settled; the destination claims its quote on its own
        // schedule, so a slow claim does not undo the transfer.
        log.warn('mint.rebalance.balance_timeout');
      }

      sink.legUpdated(verifyingLegId, { status: 'done', routing: null });
      debug({ event: 'step_done', stepId: id, amount: transferAmount });
      return { status: 'done' };
    } catch (error) {
      if (!isActive()) return { status: 'aborted' };
      // Return proofs a definitively failed melt left inflight.
      await restoreInflight(run, fromMintUrl);
      debug({
        event: 'step_error',
        stepId: id,
        amount: originalAmount,
        error: errField(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      sink.legUpdated(id, { status: 'failed', error, routing: null });
      return { status: 'failed', error };
    }
  }

  async function executeTransfer(
    step: RebalanceTransfer,
    options: { isActive: () => boolean; sink: RebalanceEventSink }
  ): Promise<RebalanceTransferOutcome> {
    if (!options.isActive()) return { status: 'aborted' };
    // Coco operations are stateful (proof selection, inflight tracking);
    // transfers run one at a time.
    if (!(await lock.acquire())) {
      log.warn('mint.rebalance.lock_failed', { stepId: step.id });
      return { status: 'busy' };
    }
    try {
      if (!options.isActive()) return { status: 'aborted' };
      return await transfer({ step, ...options, unsettledMints: new Set() });
    } finally {
      lock.release();
    }
  }

  async function runTransfers(
    steps: readonly RebalanceTransfer[],
    callbacks: RebalanceRunCallbacks
  ): Promise<RebalanceRunResult> {
    const batchStart = clock.now();
    log.info('swap.batch.start', {
      legCount: steps.filter((step) => !callbacks.isSettled(step.id)).length,
      totalSteps: steps.length,
    });
    let anyFailed = false;
    let anyPending = false;
    try {
      for (const step of steps) {
        if (!callbacks.isActive()) return { status: 'aborted' };
        // Legs settled by an earlier run (e.g. a retry of failed legs only).
        if (callbacks.isSettled(step.id)) continue;
        callbacks.onTransferStart?.(step);
        const stepStart = clock.now();
        const outcome = await executeTransfer(step, {
          isActive: callbacks.isActive,
          sink: callbacks.sinkFor(step),
        });
        if (outcome.status === 'pending') anyPending = true;
        else if (outcome.status !== 'done' && outcome.status !== 'skipped') anyFailed = true;
        callbacks.onTransferSettled?.(step, outcome);
        log.info('swap.leg.complete', {
          stepId: step.id,
          duration_ms: Math.round(clock.now() - stepStart),
          status: outcome.status,
        });
        // Space transfers out so the mints are not overwhelmed.
        if (outcome.status === 'done') await clock.sleep(NEXT_TRANSFER_PAUSE_MS);
      }
      if (!callbacks.isActive()) return { status: 'aborted' };
      return { status: 'finished', anyFailed, anyPending };
    } finally {
      log.info('swap.batch.complete', {
        duration_ms: Math.round(clock.now() - batchStart),
        aborted: !callbacks.isActive(),
      });
    }
  }

  return { executeTransfer, runTransfers, withTemporaryTrust };
}
