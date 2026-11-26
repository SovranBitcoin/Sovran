// ---------------------------------------------------------------------------
// Rebalance engine — moves funds between mints via Coco's `ops.mintSwap`
//
// Each hop delegates atomic quote preparation, source debit capping, payment
// authorization, destination proof verification and durable recovery to Coco's
// native `manager.ops.mintSwap`. This engine owns only what sits above one hop:
//
// - flexible amount sizing (fee headroom + bounded re-preparation with smaller
//   amounts before any payment is authorized, when `exactAmount` is not set);
// - multi-hop middleman routing when a direct swap fails with no route, with
//   temporary trust of untrusted intermediaries;
// - sequential batch execution and cross-run locking.
// ---------------------------------------------------------------------------

import type { MintSwapOperation } from '@cashu/coco-core';

import { amountToNumber } from '../amount';
import { logger as packageLogger, mintUrlFields, errField } from '../logger';
import {
  computeInitialTransferAmount,
  feeHeadroomFor,
  staticFeeHeadroom,
  toWholeSats,
} from './amounts';
import {
  classifyRebalanceError,
  RebalanceExactAmountError,
  RebalanceMeltRolledBackError,
  RebalanceRoutesExhaustedError,
  RebalanceSourceDebitCapError,
} from './errors';
import { createChainSteps, insertStepsAfter } from './chain';
import { defaultRebalanceClock } from './lock';
import type {
  RebalanceEngineConfig,
  RebalanceEventSink,
  RebalanceRoute,
  RebalanceRunActivity,
  RebalanceRunCallbacks,
  RebalanceRunResult,
  RebalanceTransfer,
  RebalanceTransferOutcome,
} from './types';

/** Re-preparations allowed when local proofs cannot cover amount + fees. */
const MAX_PREPARE_RETRIES = 5;
/** Sats removed per re-preparation before any payment is authorized. */
const RETRY_REDUCE_SATS = 2;
const DIRECT_OUTCOME_WAIT_MS = 35_000;
const HOP_OUTCOME_WAIT_MS = 27_000;
const OUTCOME_POLL_MS = 1_500;
const NEXT_ROUTE_PAUSE_MS = 1_500;
const NEXT_TRANSFER_PAUSE_MS = 500;

interface TransferRun extends RebalanceRunActivity {
  step: RebalanceTransfer;
  sink: RebalanceEventSink;
  /** Mints holding a swap whose source outcome is unknown. */
  unsettledMints: Set<string>;
}

type SwapLegResult =
  | { kind: 'done'; operation: MintSwapOperation }
  | { kind: 'settling'; operation: MintSwapOperation }
  | { kind: 'pending'; operationId: string }
  | { kind: 'skipped' }
  | { kind: 'aborted' }
  | { kind: 'no_route'; error: unknown; amount: number };

type ChainResult =
  | { status: 'complete'; finalHopLegId: string }
  | { status: 'settling'; finalHopLegId: string }
  | { status: 'pending'; finalHopLegId: string; operationId: string }
  | { status: 'incomplete'; finalHopLegId?: string; error?: unknown; sentHops: number };

export interface RebalanceEngine {
  /** Run one transfer to a terminal outcome. Never throws for wallet failures. */
  executeTransfer(
    step: RebalanceTransfer,
    options: RebalanceRunActivity & { sink: RebalanceEventSink }
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
  /**
   * Send `step` through the mints of `chainPath` instead: one transfer per
   * hop, placed after `step` in `steps`, run with the rest of `steps` while
   * the intermediaries are trusted. `onRerouted` is told the hop transfers
   * once they are trusted and before the first one starts.
   */
  routeThrough<T extends RebalanceTransfer>(
    step: T,
    chainPath: readonly string[],
    steps: readonly T[],
    options: RebalanceRunCallbacks & {
      makeId: (label: string) => string;
      onRerouted: (hops: T[]) => void;
      onRunFinished?: (result: RebalanceRunResult) => void;
    }
  ): Promise<RebalanceRunResult>;
}

function isDebitCapError(err: unknown): boolean {
  return err instanceof Error && err.name === 'MintSwapDebitCapError';
}

function isArrivingAtMint(op: MintSwapOperation, mintUrl: string): boolean {
  return (
    op.destinationMintUrl === mintUrl &&
    (op.state === 'destination_funded' || op.state === 'destination_pending')
  );
}

export function createRebalanceEngine(config: RebalanceEngineConfig): RebalanceEngine {
  const { wallet, lock, minTransferThreshold, minFeeReserve, sessionSignal } = config;
  const clock = config.clock ?? defaultRebalanceClock;
  const log = config.logger ?? packageLogger;
  const debug = (entry: Record<string, unknown>) => log.debug('mint.rebalance.step', entry);
  let swapSeq = 0;

  function nextSwapId(legId: string): string {
    swapSeq += 1;
    return `${legId}:${clock.now()}:${swapSeq}`;
  }

  /** Whether a new leg may open: the caller is asked first, and may end the run. */
  function mayOpenLeg(activity: RebalanceRunActivity): boolean {
    activity.beforeLegOpens?.();
    return activity.isActive();
  }

  async function readWorstCaseInputFee(mintUrl: string): Promise<number | null> {
    try {
      return await wallet.worstCaseInputFee(mintUrl);
    } catch (error) {
      log.warn('mint.rebalance.input_fee_unavailable', {
        ...mintUrlFields(mintUrl),
        error: errField(error),
      });
      return null;
    }
  }

  /** Whether any Coco mintSwap has already paid its source and is still arriving at `mintUrl`. */
  async function stillArriving(mintUrl: string): Promise<boolean> {
    try {
      const active = await wallet.mintSwap.listActive();
      return active.some((op) => isArrivingAtMint(op, mintUrl));
    } catch {
      return false;
    }
  }

  async function trustIntermediaries(chainPath: readonly string[]): Promise<string[]> {
    const temporarilyTrusted: string[] = [];
    for (const url of chainPath.slice(1, -1)) {
      if (sessionSignal?.aborted) break;
      if (config.trustedMintUrls.has(url)) continue;
      try {
        await wallet.trustMint(url);
        temporarilyTrusted.push(url);
      } catch (error) {
        log.warn('mint.rebalance.trust_failed', { ...mintUrlFields(url), error });
      }
    }
    return temporarilyTrusted;
  }

  async function releaseTrust(
    temporarilyTrusted: readonly string[],
    report: { sink: Pick<RebalanceEventSink, 'legUpdated'>; warnLegId?: string }
  ): Promise<void> {
    if (temporarilyTrusted.length === 0 || sessionSignal?.aborted) return;
    // Keep any intermediary trusted while a funded Coco mintSwap is still arriving at it.
    let activeSwaps: MintSwapOperation[] = [];
    try {
      activeSwaps = await wallet.mintSwap.listActive();
    } catch {
      activeSwaps = [];
    }
    if (sessionSignal?.aborted) return;
    const releasable = temporarilyTrusted.filter(
      (url) => !activeSwaps.some((op) => isArrivingAtMint(op, url))
    );
    const { stranded, untrustErrors } = await wallet.releaseTrust(releasable);
    for (const { url, error } of untrustErrors) {
      log.warn('mint.rebalance.untrust_failed', { ...mintUrlFields(url), error });
    }
    if (stranded.length === 0) return;
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
      await releaseTrust(temporarilyTrusted, report);
    }
  }

  // ── Single-hop execution via Coco `ops.mintSwap` ──────────────────────

  async function executeSwapLeg(
    run: TransferRun,
    params: {
      legId: string;
      fromMintUrl: string;
      toMintUrl: string;
      requestedAmount: number;
      sourceDebitCap?: number;
      exactAmount?: boolean;
      waitTimeoutMs: number;
      allowNoRouteFallback: boolean;
      chainMeta?: { chainId: string; chainPath: string[]; chainHopIndex: number };
    }
  ): Promise<SwapLegResult> {
    const { sink, isActive } = run;
    const {
      legId,
      fromMintUrl,
      toMintUrl,
      requestedAmount,
      sourceDebitCap,
      exactAmount = false,
      waitTimeoutMs,
      allowNoRouteFallback,
      chainMeta,
    } = params;

    if (!isActive()) return { kind: 'aborted' };

    const balances = await wallet.balancesByMint();
    if (sessionSignal?.aborted) return { kind: 'aborted' };
    const sourceBalance = toWholeSats(balances[fromMintUrl] ?? 0) ?? 0;
    const worstCaseInputFee = await readWorstCaseInputFee(fromMintUrl);
    const feeHeadroom =
      worstCaseInputFee !== null
        ? feeHeadroomFor(minFeeReserve, worstCaseInputFee)
        : staticFeeHeadroom(minFeeReserve);

    let currentAmount: number;
    if (exactAmount) {
      const exact = toWholeSats(requestedAmount) ?? 0;
      if (exact < minTransferThreshold || sourceBalance < exact) {
        throw new RebalanceExactAmountError(exact, sourceBalance);
      }
      currentAmount = exact;
    } else {
      const decision = computeInitialTransferAmount({
        requestedAmount,
        sourceBalance,
        minTransferThreshold,
        feeHeadroom,
      });
      if (decision.status === 'skip') {
        sink.legUpdated(legId, { status: 'skipped', error: null });
        return { kind: 'skipped' };
      }
      currentAmount = decision.amount;
    }

    sink.legOpened(legId, {
      fromMintUrl,
      toMintUrl,
      amount: currentAmount,
      ...(chainMeta && {
        chainId: chainMeta.chainId,
        chainPath: chainMeta.chainPath,
        chainHopIndex: chainMeta.chainHopIndex,
      }),
    });
    sink.legUpdated(legId, { status: 'creatingInvoice', error: null });

    // 1. Prepare via Coco ops.mintSwap (bounded shrink before any payment if !exactAmount)
    let prepared: MintSwapOperation | null = null;
    for (let attempt = 0; attempt <= MAX_PREPARE_RETRIES; attempt++) {
      if (!isActive()) return { kind: 'aborted' };
      const swapId = nextSwapId(legId);
      try {
        const op = await wallet.mintSwap.prepare({
          id: swapId,
          sourceMintUrl: fromMintUrl,
          destinationMintUrl: toMintUrl,
          destinationAmount: currentAmount,
          ...(sourceDebitCap !== undefined && { sourceDebitCap }),
        });
        if (op.state === 'failed') {
          if (op.failure.code === 'source_debit_cap_exceeded') {
            const maxDebit =
              op.lastSafe.state !== 'preparing'
                ? amountToNumber(op.lastSafe.sourceDebitBounds.maximum)
                : currentAmount;
            throw new RebalanceSourceDebitCapError(op.id, maxDebit, sourceDebitCap ?? 0);
          }
          if (
            !exactAmount &&
            attempt < MAX_PREPARE_RETRIES &&
            currentAmount - RETRY_REDUCE_SATS >= minTransferThreshold
          ) {
            currentAmount -= RETRY_REDUCE_SATS;
            continue;
          }
          throw new Error(`Mint swap preparation rejected (${op.failure.code})`);
        }
        prepared = op;
        break;
      } catch (err) {
        if (isDebitCapError(err)) {
          throw new RebalanceSourceDebitCapError(swapId, currentAmount, sourceDebitCap ?? 0);
        }
        const kind = classifyRebalanceError(err);
        if (kind === 'insufficient_proofs' || kind === 'input_shortfall') {
          if (
            !exactAmount &&
            attempt < MAX_PREPARE_RETRIES &&
            currentAmount - RETRY_REDUCE_SATS >= minTransferThreshold
          ) {
            currentAmount -= RETRY_REDUCE_SATS;
            continue;
          }
          if (exactAmount) {
            throw new RebalanceExactAmountError(requestedAmount, Math.max(0, currentAmount - 1));
          }
        }
        throw err;
      }
    }

    if (!prepared) {
      throw new Error('Could not prepare mint swap');
    }

    sink.swapPrepared(legId, prepared);
    sink.legUpdated(legId, { status: 'invoiceReady', operationId: prepared.id });

    if (!isActive()) {
      await wallet.mintSwap.cancel(prepared.id).catch(() => undefined);
      return { kind: 'aborted' };
    }

    // 2. Authorize payment ONCE via Coco ops.mintSwap.execute
    sink.legUpdated(legId, { status: 'melting', operationId: prepared.id });
    let op: MintSwapOperation | null;
    let executeError: unknown;
    try {
      op = await wallet.mintSwap.execute(prepared.id);
    } catch (err) {
      if (sessionSignal?.aborted) return { kind: 'aborted' };
      executeError = err;
      op = await wallet.mintSwap.get(prepared.id).catch((lookupError: unknown) => {
        debug({ event: 'execute_outcome_unknown', legId, error: errField(lookupError) });
        return null;
      });
      if (!op) {
        run.unsettledMints.add(fromMintUrl);
        sink.legUpdated(legId, { status: 'paymentPending', operationId: prepared.id });
        return { kind: 'pending', operationId: prepared.id };
      }
    }

    if (sessionSignal?.aborted) return { kind: 'aborted' };

    // 3. Observe durable outcome if Coco left the swap in flight
    if (
      op.state === 'source_pending' ||
      op.state === 'destination_funded' ||
      op.state === 'destination_pending'
    ) {
      if (op.state === 'destination_funded' || op.state === 'destination_pending') {
        sink.legUpdated(legId, { status: 'verifying' });
      }
      try {
        const outcome = await wallet.mintSwap.waitForOutcome(op.id, {
          timeoutMs: waitTimeoutMs,
          pollIntervalMs: OUTCOME_POLL_MS,
          ...(sessionSignal && { signal: sessionSignal }),
        });
        op = outcome.operation;
      } catch (err) {
        if (sessionSignal?.aborted) return { kind: 'aborted' };
        debug({ event: 'wait_outcome_error', legId, error: errField(err) });
        op = (await wallet.mintSwap.get(op.id).catch(() => null)) ?? op;
      }
    }

    if (sessionSignal?.aborted) return { kind: 'aborted' };
    switch (op.state) {
      case 'completed':
        sink.legUpdated(legId, { status: 'done', error: null });
        return { kind: 'done', operation: op };

      case 'destination_funded':
      case 'destination_pending':
        sink.legUpdated(legId, { status: 'settling' });
        return { kind: 'settling', operation: op };

      case 'source_pending':
      case 'needs_attention':
        run.unsettledMints.add(fromMintUrl);
        sink.legUpdated(legId, { status: 'paymentPending' });
        return { kind: 'pending', operationId: op.id };

      case 'cancelled':
        if (!isActive()) return { kind: 'aborted' };
        throw executeError ?? new RebalanceMeltRolledBackError(op.id);

      case 'failed': {
        if (op.failure.code === 'source_debit_cap_exceeded') {
          const maxDebit =
            op.lastSafe.state !== 'preparing'
              ? amountToNumber(op.lastSafe.sourceDebitBounds.maximum)
              : currentAmount;
          throw new RebalanceSourceDebitCapError(op.id, maxDebit, sourceDebitCap ?? 0);
        }
        const failureError =
          executeError ?? new RebalanceMeltRolledBackError(op.id, 'Lightning payment failed');
        if (
          allowNoRouteFallback &&
          (op.failure.code === 'source_payment_rejected' ||
            classifyRebalanceError(failureError) === 'no_route')
        ) {
          return { kind: 'no_route', error: failureError, amount: currentAmount };
        }
        throw failureError;
      }

      default:
        throw executeError ?? new Error(`Unexpected mint swap state: ${op.state}`);
    }
  }

  // ── Middleman routing ─────────────────────────────────────────────────

  async function runChain(
    run: TransferRun,
    params: {
      route: RebalanceRoute;
      chainId: string;
      hopLegIds: string[];
      transferAmount: number;
    }
  ): Promise<ChainResult> {
    const { sink } = run;
    const { route, chainId, hopLegIds, transferAmount } = params;
    const hopCount = route.path.length - 1;
    let sentHops = 0;
    let lastHopLegId: string | undefined;

    for (let i = 0; i < hopCount; i++) {
      if (!mayOpenLeg(run)) {
        return { status: 'incomplete', finalHopLegId: lastHopLegId, sentHops };
      }
      const fromMintUrl = route.path[i];
      const toMintUrl = route.path[i + 1];
      const legId = hopLegIds[i];
      lastHopLegId = legId;

      sink.legUpdated(run.step.id, {
        routing: { kind: 'hop', hopIndex: i, hopCount, fromMintUrl, toMintUrl },
      });

      try {
        const result = await executeSwapLeg(run, {
          legId,
          fromMintUrl,
          toMintUrl,
          requestedAmount: transferAmount,
          waitTimeoutMs: HOP_OUTCOME_WAIT_MS,
          allowNoRouteFallback: false,
          chainMeta: { chainId, chainPath: route.path, chainHopIndex: i },
        });
        if (result.kind === 'done') {
          sentHops += 1;
          continue;
        }
        if (result.kind === 'settling') {
          return { status: 'settling', finalHopLegId: legId };
        }
        if (result.kind === 'pending') {
          return { status: 'pending', finalHopLegId: legId, operationId: result.operationId };
        }
        if (result.kind === 'aborted') {
          return { status: 'incomplete', finalHopLegId: legId, sentHops };
        }
        // skipped or no_route inside a hop
        return {
          status: 'incomplete',
          finalHopLegId: legId,
          error: result.kind === 'no_route' ? result.error : new Error('Hop amount too small'),
          sentHops,
        };
      } catch (err) {
        sink.legUpdated(legId, { status: 'failed', error: err });
        return { status: 'incomplete', finalHopLegId: legId, error: err, sentHops };
      }
    }

    return { status: 'complete', finalHopLegId: lastHopLegId ?? hopLegIds[hopCount - 1] };
  }

  async function routeThroughMiddlemen(
    run: TransferRun,
    noRouteError: unknown,
    transferAmount: number
  ): Promise<RebalanceTransferOutcome> {
    const { step, sink } = run;
    const { id, fromMintUrl, toMintUrl } = step;
    debug({ event: 'no_route_auto_routing', stepId: id });
    sink.legUpdated(id, { status: 'routing', error: null, routing: { kind: 'searching' } });

    const routes = await config.findRoutes(fromMintUrl, toMintUrl);
    if (routes.length === 0) {
      sink.legUpdated(id, { status: 'failed', error: noRouteError, routing: null });
      return { status: 'failed', error: noRouteError };
    }

    let lastError: unknown = noRouteError;
    for (let index = 0; index < routes.length; index++) {
      if (!mayOpenLeg(run)) return { status: 'aborted' };
      const route = routes[index];
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
      if (sessionSignal?.aborted) return { status: 'aborted' };
      const { chainId, hopLegIds } = sink.routeAttemptStarted(id, {
        route,
        index,
        count: routes.length,
      });
      const result = await runChain(run, { route, chainId, hopLegIds, transferAmount });
      await releaseTrust(temporarilyTrusted, { sink, warnLegId: result.finalHopLegId ?? id });
      if (!run.isActive()) return { status: 'aborted' };

      if (result.status === 'complete') return { status: 'done' };
      if (result.status === 'settling') return { status: 'settling' };
      if (result.status === 'pending') {
        return { status: 'pending', operationId: result.operationId };
      }
      if (result.error !== undefined) lastError = result.error;
      if (result.sentHops > 0) {
        sink.legUpdated(id, { status: 'failed', error: lastError });
        return { status: 'failed', error: lastError };
      }
      await clock.sleep(NEXT_ROUTE_PAUSE_MS);
    }

    if (!run.isActive()) return { status: 'aborted' };
    const finalError =
      routes.length > 1
        ? new RebalanceRoutesExhaustedError(routes.length, { cause: lastError })
        : lastError;
    sink.legUpdated(id, { status: 'failed', error: finalError });
    return { status: 'failed', error: finalError };
  }

  // ── Direct transfer & batch runner ────────────────────────────────────

  async function transfer(run: TransferRun): Promise<RebalanceTransferOutcome> {
    const { step, sink } = run;
    try {
      const result = await executeSwapLeg(run, {
        legId: step.id,
        fromMintUrl: step.fromMintUrl,
        toMintUrl: step.toMintUrl,
        requestedAmount: step.amount,
        sourceDebitCap: step.sourceDebitCap,
        exactAmount: step.exactAmount,
        waitTimeoutMs: DIRECT_OUTCOME_WAIT_MS,
        allowNoRouteFallback: !step.directOnly,
        ...(step.chainId &&
          step.chainPath &&
          step.chainHopIndex !== undefined && {
            chainMeta: {
              chainId: step.chainId,
              chainPath: step.chainPath,
              chainHopIndex: step.chainHopIndex,
            },
          }),
      });
      switch (result.kind) {
        case 'done':
          return { status: 'done' };
        case 'skipped':
          return { status: 'skipped' };
        case 'settling':
          return { status: 'settling' };
        case 'pending':
          return { status: 'pending', operationId: result.operationId };
        case 'aborted':
          return { status: 'aborted' };
        case 'no_route':
          return await routeThroughMiddlemen(run, result.error, result.amount);
      }
    } catch (err) {
      if (!run.isActive()) return { status: 'aborted' };
      sink.legUpdated(step.id, { status: 'failed', error: err });
      return { status: 'failed', error: err };
    }
  }

  async function executeTransfer(
    step: RebalanceTransfer,
    options: RebalanceRunActivity & { sink: RebalanceEventSink }
  ): Promise<RebalanceTransferOutcome> {
    if (!mayOpenLeg(options)) return { status: 'aborted' };
    if (!(await lock.acquire())) {
      log.warn('mint.rebalance.lock_failed', { stepId: step.id });
      return { status: 'busy' };
    }
    try {
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
        if (!mayOpenLeg(callbacks)) return { status: 'aborted' };
        if (callbacks.isSettled(step.id)) continue;
        const arriving = await stillArriving(step.fromMintUrl);
        if (sessionSignal?.aborted) return { status: 'aborted' };
        if (arriving) {
          anyPending = true;
          log.info('swap.leg.held', { stepId: step.id });
          continue;
        }
        callbacks.onTransferStart?.(step);
        const stepStart = clock.now();
        const outcome = await executeTransfer(step, {
          isActive: callbacks.isActive,
          beforeLegOpens: callbacks.beforeLegOpens,
          sink: callbacks.sinkFor(step),
        });
        if (outcome.status === 'pending' || outcome.status === 'settling') anyPending = true;
        else if (outcome.status !== 'done' && outcome.status !== 'skipped') anyFailed = true;
        callbacks.onTransferSettled?.(step, outcome);
        log.info('swap.leg.complete', {
          stepId: step.id,
          duration_ms: Math.round(clock.now() - stepStart),
          status: outcome.status,
        });
        if (outcome.status === 'done' || outcome.status === 'settling') {
          await clock.sleep(NEXT_TRANSFER_PAUSE_MS);
        }
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

  function routeThrough<T extends RebalanceTransfer>(
    step: T,
    chainPath: readonly string[],
    steps: readonly T[],
    options: RebalanceRunCallbacks & {
      makeId: (label: string) => string;
      onRerouted: (hops: T[]) => void;
      onRunFinished?: (result: RebalanceRunResult) => void;
    }
  ): Promise<RebalanceRunResult> {
    const hops = createChainSteps({
      baseStep: step,
      chainPath,
      chainId: options.makeId('chain'),
      idPrefix: `reroute-${step.id}`,
      makeId: options.makeId,
    });
    const rerouted = insertStepsAfter(steps, step.id, hops);
    return withTemporaryTrust(
      chainPath,
      { sink: options.sinkFor(step), warnLegId: hops[hops.length - 1]?.id },
      async () => {
        options.onRerouted(hops);
        const result = await runTransfers(rerouted, options);
        options.onRunFinished?.(result);
        return result;
      }
    );
  }

  return { executeTransfer, runTransfers, withTemporaryTrust, routeThrough };
}
