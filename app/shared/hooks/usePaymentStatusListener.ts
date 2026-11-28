/**
 * Subscribes to coco events and reports each payment's progress to its toast.
 * Receive (mint): mint-quote:updated (PAID) or mint-op:pending (quote PAID) → mint-op:finalized.
 * Receive (ecash): toast started on redeem → receive-op:finalized / history:updated finish it.
 * Send: send:finalized finishes the send / payment-request toast of that send.
 * Melt: toast started on confirm → melt-op:finalized / melt-op:rolled-back of that melt end it.
 *
 * Every toast is keyed by its payment (`toastKey`): an event only ever reaches
 * the toast of the payment it is about, and two payments in flight together
 * have a toast each. What a toast shows, and for how long, is the payment
 * toast machine's (`paymentToastMachine`).
 */

import { useEffect } from 'react';

import { getMintQuoteRemoteState } from '@cashu/coco-core';
import { useManagerContext } from '@cashu/coco-react';

import {
  annotationKey,
  reusableQuoteKey,
  rotateReusableMintQuote,
  rotateStandingPaymentRequest,
  standingPaymentRequestKey,
} from 'wallet';
import { describeError } from '@/shared/lib/errors';
import {
  paymentToasts,
  toastKey,
  type PaymentToastContent,
} from '@/shared/stores/runtime/paymentStatusStore';
import { isSwapStatusActive } from '@/shared/stores/runtime/swapStatusStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';
import { amountToNumber } from 'wallet/amount';
import { paymentLog, mintUrlLogFields } from '@/shared/lib/logger';

const NPC_RECEIVE_POPUP_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Persist the durable settlement facts of an onchain melt (NUT-30 send) into
 * the transaction annotation store under `quote:<quoteId>`: the outpoint
 * (txid:vout) and the fee the user agreed to. The mint may stop serving the
 * quote row later (pruning, offline) and coco's MeltHistoryEntry never carries
 * the outpoint — without this the history detail loses its explorer link and
 * fee line forever. Best-effort: must never block or fail the toast path.
 */
async function persistOnchainMeltAnnotation(
  manager: {
    quotes: { melt: { get: (args: { mintUrl: string; quoteId: string }) => Promise<unknown> } };
  },
  mintUrl: string,
  operation: Record<string, unknown>
): Promise<void> {
  try {
    if (operation.method !== 'onchain') return;
    const quoteId =
      typeof operation.quoteId === 'string' && operation.quoteId ? operation.quoteId : null;
    if (!quoteId) return;

    const finalizedData =
      operation.finalizedData && typeof operation.finalizedData === 'object'
        ? (operation.finalizedData as Record<string, unknown>)
        : null;
    const outpoint =
      typeof finalizedData?.outpoint === 'string' && finalizedData.outpoint
        ? finalizedData.outpoint
        : undefined;
    const methodData =
      operation.methodData && typeof operation.methodData === 'object'
        ? (operation.methodData as Record<string, unknown>)
        : null;
    const feeIndex = typeof methodData?.feeIndex === 'number' ? methodData.feeIndex : undefined;
    const address =
      typeof methodData?.address === 'string' && methodData.address
        ? methodData.address
        : undefined;
    const amountSats =
      methodData?.amountSats != null
        ? amountToNumber(methodData.amountSats as Parameters<typeof amountToNumber>[0])
        : undefined;
    const effectiveFeeSats =
      operation.effectiveFee != null
        ? amountToNumber(operation.effectiveFee as Parameters<typeof amountToNumber>[0])
        : undefined;

    // The selected option's fee_reserve lives on the quote row (a LOCAL read —
    // no network); resolve it so the fee line can show "max" before coco
    // reports an effective fee.
    let feeReserveSats: number | undefined;
    if (feeIndex != null) {
      try {
        const quote = (await manager.quotes.melt.get({ mintUrl, quoteId })) as {
          fee_options?: { fee_index?: number; fee_reserve?: unknown }[];
        } | null;
        const option = quote?.fee_options?.find((o) => o?.fee_index === feeIndex);
        if (option?.fee_reserve != null) {
          feeReserveSats = amountToNumber(
            option.fee_reserve as Parameters<typeof amountToNumber>[0]
          );
        }
      } catch {
        // Local quote row unavailable — the reserve just stays unknown.
      }
    }

    // A melt that finalized WITHOUT an outpoint settled off-chain (internal
    // settlement: the mint paid without a transaction). Persisting the verdict
    // here makes it instant on every later mount — no re-polling. A mint that
    // publishes the outpoint late self-heals: the outpoint always outranks
    // this flag (`settledInternally = settledOffchain && !outpoint`).
    const settledOffchain = outpoint == null;

    setTransactionAnnotation(annotationKey({ type: 'melt', quoteId }), {
      onchainMelt: {
        ...(outpoint ? { outpoint, outpointSource: 'mint' as const } : {}),
        ...(feeIndex != null ? { feeIndex } : {}),
        ...(feeReserveSats != null && Number.isFinite(feeReserveSats) ? { feeReserveSats } : {}),
        ...(effectiveFeeSats != null && Number.isFinite(effectiveFeeSats)
          ? { effectiveFeeSats }
          : {}),
        ...(settledOffchain ? { settledOffchain: true } : {}),
        ...(address ? { address } : {}),
        ...(amountSats != null && Number.isFinite(amountSats) ? { amountSats } : {}),
      },
    });
    paymentLog.info('hook.payment_status.onchain_melt_annotated', {
      hasOutpoint: !!outpoint,
      feeIndex: feeIndex ?? null,
      hasFeeReserve: feeReserveSats != null,
      hasEffectiveFee: effectiveFeeSats != null,
      settledOffchain,
      hasAddress: !!address,
      hasAmountSats: amountSats != null,
    });
  } catch (error) {
    paymentLog.warn('hook.payment_status.onchain_melt_annotate_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

type PaymentContent = Extract<PaymentToastContent, { kind: 'payment' }>;

/**
 * The content of a payment's toast once it has a result: what it already
 * showed (so a payment request stays one), without wording that only
 * described the wait, or `fresh` when the payment had no toast.
 */
function resultContent(key: string, fresh: PaymentContent): PaymentContent {
  const current = paymentToasts.get(key)?.content;
  if (current?.kind !== 'payment') return fresh;
  return {
    kind: 'payment',
    variant: current.variant,
    mintUrl: current.mintUrl,
    amount: current.amount,
    unit: current.unit,
    ...((fresh.target ?? current.target) ? { target: fresh.target ?? current.target } : {}),
  };
}

/**
 * Decide whether a `mint-op:pending` event with `lastObservedRemoteState === 'PAID'`
 * should surface a "Payment received" toast. Only NPC sync produces these events
 * (live in-app mints emit pending with state 'UNPAID' and transition via
 * quote-state-changed), so we treat anything older than the threshold — or with
 * no observed-state timestamp at all — as a retroactive replay (recovery,
 * cold-start sync) and stay silent.
 *
 * `lastObservedRemoteStateAt` is set to `Date.now()` by MintBolt11Handler.prepare
 * when the NPC plugin imports the quote, so the freshness window is "import time
 * was within 5 minutes" — newly synced NPC payments fire, stale replays don't.
 */
function shouldShowNpcReceivePopup(
  observedAtMs: number | undefined,
  nowMs: number = Date.now()
): boolean {
  if (typeof observedAtMs !== 'number' || !Number.isFinite(observedAtMs) || observedAtMs <= 0) {
    return false;
  }
  return nowMs - observedAtMs <= NPC_RECEIVE_POPUP_MAX_AGE_MS;
}

/**
 * The ecash receive toast an event for `mintUrl` + `amount` is about. Coco's
 * receive events carry no id the redeem flow knows, so it is matched by mint
 * and amount: one still in flight first, else one that ended without its
 * history entry yet.
 */
function receiveEcashToast(
  mintUrl: string,
  amount: number
): { key: string; content: PaymentContent } | null {
  const candidates = paymentToasts.tracked().flatMap((toast) => {
    const { content } = toast;
    return content.kind === 'payment' &&
      content.variant === 'receive-ecash' &&
      content.mintUrl === mintUrl &&
      content.amount === amount &&
      toast.phase !== 'failed' &&
      !(content.target?.type === 'receive' && content.target.entryId)
      ? [{ key: toast.key, phase: toast.phase, content }]
      : [];
  });
  return candidates.find((toast) => toast.phase !== 'done') ?? candidates[0] ?? null;
}

/**
 * Start the receive toast of a paid quote. A quote already being shown (or
 * already shown as received) is not started twice.
 * The caller supplies its existing source-specific processing log event.
 */
function activateReceiveProcessing({
  processingLogEvent,
  quoteId,
  mintUrl,
  amount,
  unit,
}: {
  processingLogEvent:
    'hook.payment_status.receive_processing' | 'hook.payment_status.npc_receive_processing';
  quoteId: string;
  mintUrl: string;
  amount: number;
  unit: string;
}): void {
  paymentLog.info(processingLogEvent, {
    quoteId,
    ...mintUrlLogFields(mintUrl),
    amount,
    unit,
    isDuplicate: !!paymentToasts.get(toastKey.mint(quoteId)),
  });
  paymentToasts.start(
    toastKey.mint(quoteId),
    {
      kind: 'payment',
      variant: 'receive',
      mintUrl,
      amount,
      unit,
      target: { type: 'mint', quoteId },
    },
    { ids: [quoteId] }
  );
}

type CocoManager = NonNullable<ReturnType<typeof useManagerContext>['manager']>;

/**
 * The NPC branch of `mint-op:pending`, verbatim: fetch the canonical quote
 * row, gate on PAID + swap suppression + freshness, then surface the
 * receive-processing toast.
 */
async function surfaceNpcPaidQuote(ctx: {
  manager: CocoManager;
  mintUrl: string;
  quoteId: string;
  amount: number;
  unit: string;
  isDisposed: () => boolean;
}): Promise<void> {
  const { manager, mintUrl, quoteId, amount, unit, isDisposed } = ctx;
  if (isDisposed()) return;
  // v2 moved remote-state observation off the operation onto the
  // canonical quote row — fetch it for the PAID check + NPC freshness.
  let state: string | undefined;
  let lastObservedRemoteStateAt: number | undefined;
  try {
    const quote = await manager.quotes.mint.get({ mintUrl, quoteId });
    if (isDisposed()) return;
    // coco's Mint Quote Accounting refactor removed the observation
    // fields from mint quotes: state is now derived from
    // amountPaid/amountIssued, and the local (millisecond) `updatedAt` is
    // the observation timestamp. `remoteUpdatedAt` is NOT a substitute —
    // it is mint-reported protocol *seconds*.
    state = quote ? getMintQuoteRemoteState(quote) : undefined;
    lastObservedRemoteStateAt = quote?.updatedAt;
  } catch (error) {
    paymentLog.debug('hook.payment_status.mint_quote_lookup_failed', {
      quoteId,
      ...mintUrlLogFields(mintUrl),
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  paymentLog.debug('hook.payment_status.mint_quote_added', {
    quoteId,
    state,
    ...mintUrlLogFields(mintUrl),
  });
  if (state !== 'PAID') return;

  if (isSwapStatusActive()) {
    paymentLog.info('hook.payment_status.suppressed_for_swap', {
      quoteId,
      ...mintUrlLogFields(mintUrl),
      phase: 'mint_quote_added',
    });
    return;
  }

  if (!shouldShowNpcReceivePopup(lastObservedRemoteStateAt)) {
    paymentLog.info('hook.payment_status.npc_quote_suppressed', {
      quoteId,
      ...mintUrlLogFields(mintUrl),
      observedAt: lastObservedRemoteStateAt ?? null,
      ageMs:
        typeof lastObservedRemoteStateAt === 'number'
          ? Date.now() - lastObservedRemoteStateAt
          : null,
      reason: lastObservedRemoteStateAt == null ? 'no_observed_at' : 'too_old',
    });
    return;
  }

  activateReceiveProcessing({
    processingLogEvent: 'hook.payment_status.npc_receive_processing',
    quoteId,
    mintUrl,
    amount,
    unit,
  });
}

/**
 * Rotate the standing NUT-18 payment request after a claim landed on it,
 * verbatim from the `receive-op:finalized` handler. Best-effort.
 */
async function rotateStandingCreqAfterClaim(ctx: {
  manager: CocoManager;
  requestOpId: string;
  unit: string;
}): Promise<void> {
  const { manager, requestOpId, unit } = ctx;
  try {
    const trusted = await manager.mint.getAllTrustedMints();
    await rotateStandingPaymentRequest(
      manager,
      { unit, mints: trusted.map((m) => m.mintUrl).slice(0, 5) },
      {
        get: (key) => useMintStore.getState().standingQuotes[key],
        set: (key, id) => useMintStore.getState().setStandingQuote(key, id),
      }
    );
  } catch (err) {
    paymentLog.warn('hook.payment_status.creq_standing_rotation_failed', {
      requestOpId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function usePaymentStatusListener(): void {
  const { manager } = useManagerContext();

  useEffect(() => {
    if (!manager) {
      paymentLog.debug('hook.payment_status.no_manager');
      return;
    }
    paymentLog.info('hook.payment_status.subscribing');
    let disposed = false;

    const offStateChanged = manager.on(
      'mint-quote:updated',
      ({ mintUrl, method, quoteId, quote }) => {
        // Reusable (bolt12/onchain) quotes track paid/issued balances in
        // quoteData and surface through mint-op events once the processor
        // claims them; the PAID toast here is for one-shot bolt11 invoices.
        if (quote.method !== 'bolt11') return;
        const remoteState = quote.state;

        paymentLog.debug('hook.payment_status.mint_quote_updated', {
          quoteId,
          state: remoteState ?? null,
          method,
          ...mintUrlLogFields(mintUrl),
        });
        if (remoteState !== 'PAID') return;

        // Suppress per-leg toasts while a swap is running — the unified
        // swap toast owns the user-facing surface for the duration.
        if (isSwapStatusActive()) {
          paymentLog.info('hook.payment_status.suppressed_for_swap', {
            quoteId,
            ...mintUrlLogFields(mintUrl),
            phase: 'mint_quote_updated',
          });
          return;
        }

        const amount = amountToNumber(quote.amount);
        const unit = quote.unit;

        activateReceiveProcessing({
          processingLogEvent: 'hook.payment_status.receive_processing',
          quoteId,
          mintUrl,
          amount,
          unit,
        });
      }
    );

    const offAdded = manager.on('mint-op:pending', ({ mintUrl, operationId, operation }) => {
      // The MintOperation union includes `init` (no quoteId/observed state); only
      // pending-or-later carries the quote snapshot we need.
      if (operation.state === 'init') {
        paymentLog.debug('hook.payment_status.mint_pending_init_skipped', {
          operationId,
          ...mintUrlLogFields(mintUrl),
        });
        return;
      }

      // NPC-imported paid quotes are bolt11; reusable (bolt12/onchain)
      // deposits settle via mint-op:finalized instead. Gating here also
      // saves a canonical-quote DB read per pending event.
      if (operation.method !== 'bolt11') {
        paymentLog.debug('hook.payment_status.mint_pending_non_bolt11_skipped', {
          operationId,
          method: operation.method,
        });
        return;
      }

      const { quoteId, unit } = operation;
      const amount = amountToNumber(operation.amount);
      void surfaceNpcPaidQuote({
        manager,
        mintUrl,
        quoteId,
        amount,
        unit,
        isDisposed: () => disposed,
      });
    });

    const offRedeemed = manager.on('mint-op:finalized', ({ mintUrl, operationId, operation }) => {
      // rc.2 narrows the finalized payload to FinalizedMintOperation, which
      // always carries quoteId — no init-state defense needed anymore.
      const quoteId = operation.quoteId;
      paymentLog.info('hook.payment_status.mint_quote_redeemed', { operationId, quoteId });
      const key = toastKey.mint(quoteId);
      const hadToast = !!paymentToasts.get(key);
      const received = (): PaymentContent =>
        resultContent(key, {
          kind: 'payment',
          variant: 'receive',
          mintUrl,
          amount: amountToNumber(operation.amount),
          unit: operation.unit,
          target: { type: 'mint', quoteId },
        });
      if (hadToast) paymentToasts.report(key, 'done', received(), { ids: [quoteId, operationId] });

      // Onchain address-reuse policy (mirrors P2PK rotation-on-receive): a
      // deposit that lands on the STANDING onchain address retires it — the
      // next payer gets a fresh address. Fixed-amount quotes are one-offs
      // and never match the recorded standing id, so they don't rotate
      // anything. The old quote stays pending in coco, so late payments to
      // the retired address still auto-mint.
      if (operation.method === 'onchain') {
        const rotationInput = {
          mintUrl,
          method: 'onchain' as const,
          unit: operation.unit,
        };
        const standingKey = reusableQuoteKey(rotationInput);
        const mintState = useMintStore.getState();
        if (mintState.standingQuotes[standingKey] === quoteId) {
          paymentLog.info('hook.payment_status.onchain_standing_rotation', {
            quoteId,
            ...mintUrlLogFields(mintUrl),
          });
          void rotateReusableMintQuote(
            manager,
            rotationInput,
            {
              get: (key) => useMintStore.getState().standingQuotes[key],
              set: (key, id) => useMintStore.getState().setStandingQuote(key, id),
            },
            'deposit_received'
          ).catch((err) => {
            paymentLog.warn('hook.payment_status.onchain_standing_rotation_failed', {
              quoteId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      }

      // Standing-quote deposits (bolt12 offer / onchain address) auto-mint
      // with no prior toast — surface a confirmed receive so the deposit
      // isn't silent. bolt11 mints already ran the PAID-processing toast.
      if (!hadToast && operation.method !== 'bolt11') {
        if (isSwapStatusActive()) return;
        paymentLog.info('hook.payment_status.reusable_deposit_confirmed', {
          quoteId,
          method: operation.method,
          ...mintUrlLogFields(mintUrl),
          amount: amountToNumber(operation.amount),
          unit: operation.unit,
        });
        paymentToasts.report(key, 'done', received(), { ids: [quoteId, operationId] });
      }
    });

    // NUT-18 payment-request claims arrive silently over Nostr (the transport
    // plugin ingests DM payloads with no user gesture) — surface the settled
    // receive, mirroring the standing bolt12/onchain deposit toast above.
    const offPrReceive = manager.on('receive-op:finalized', ({ mintUrl, operation }) => {
      const source = (operation as { source?: { type?: string } }).source;
      if (source?.type !== 'payment-request') return;
      if (isSwapStatusActive()) return;
      const op = operation as unknown as { id: string; amount: unknown; unit: string };
      const amount = amountToNumber(op.amount as never);
      paymentLog.info('hook.payment_status.payment_request_claimed', {
        operationId: op.id,
        ...mintUrlLogFields(mintUrl),
        amount,
        unit: op.unit,
      });

      // Persist the payment-request linkage onto the receive so the history
      // detail presents it as a payment-request claim, not plain redeemed
      // ecash. coco's `source` only lives on the operation row — the merged
      // history entry keys off `op:<operationId>` via candidateKeys.
      const prSource = source as {
        requestId?: string;
        transport?: string;
      };
      setTransactionAnnotation(`op:${op.id}`, {
        paymentRequest: {
          role: 'payee',
          ...(prSource.requestId ? { requestId: prSource.requestId } : {}),
          ...(prSource.transport === 'nostr' ||
          prSource.transport === 'inband' ||
          prSource.transport === 'post'
            ? { transport: prSource.transport }
            : {}),
        },
      });
      paymentToasts.report(
        toastKey.receive(op.id),
        'done',
        {
          kind: 'payment',
          variant: 'receive',
          mintUrl,
          amount,
          unit: op.unit,
          target: { type: 'receive', operationId: op.id },
        },
        { ids: [op.id] }
      );

      // If this payment landed on the STANDING reusable request (the "QR Display"
      // Cashu rail), rotate to a fresh one — same chokepoint + identity-store
      // handoff as the onchain deposit rotation above, so the displayed QR is
      // never a request that was already paid, and rotation happens even with the
      // screen closed. Single-use "Fixed Amount" requests aren't recorded in
      // standingQuotes, so they never match and correctly skip rotation.
      const requestOpId = (source as { requestOperationId?: string }).requestOperationId;
      if (requestOpId) {
        const standingKey = standingPaymentRequestKey(op.unit);
        if (useMintStore.getState().standingQuotes[standingKey] === requestOpId) {
          paymentLog.info('hook.payment_status.creq_standing_rotation', {
            requestOpId,
            unit: op.unit,
          });
          void rotateStandingCreqAfterClaim({ manager, requestOpId, unit: op.unit });
        }
      }
    });

    // The receiveEntryId enrichment used to race a 50ms setTimeout against
    // HistoryService.handleReceiveOperationUpdated. Subscribe to the event
    // instead — `history:updated` fires once the entry is persisted, and
    // we narrow to `state: 'finalized'` so a prepared-state update doesn't
    // confirm the toast prematurely.
    const offHistoryUpdated = manager.on('history:updated', ({ mintUrl, entry }) => {
      if (entry.type !== 'receive' || entry.state !== 'finalized') return;
      const amount = amountToNumber(entry.amount);
      const toast = entry.id ? receiveEcashToast(mintUrl, amount) : null;
      if (!toast) {
        paymentLog.debug('hook.payment_status.receive_entry_link_skipped', {
          ...mintUrlLogFields(mintUrl),
          amount,
          entryId: entry.id ?? null,
          reason: entry.id ? 'no_receive_toast_without_entry' : 'entry_missing_id',
        });
        return;
      }
      paymentLog.info('hook.payment_status.receive_entry_linked', {
        ...mintUrlLogFields(mintUrl),
        amount,
        entryId: entry.id,
      });
      paymentToasts.report(
        toast.key,
        'done',
        resultContent(toast.key, {
          ...toast.content,
          target: { type: 'receive', entryId: entry.id },
        }),
        { ids: [entry.id] }
      );
    });

    const offReceiveCreated = manager.on('receive-op:finalized', ({ mintUrl, operation }) => {
      const amount = amountToNumber(operation.amount);
      paymentLog.info('hook.payment_status.receive_created', {
        ...mintUrlLogFields(mintUrl),
        amount,
        operationId: operation.id,
      });
      // Finish the toast even if history:updated has not fired yet — the
      // entry id for View may arrive a tick later.
      const toast = receiveEcashToast(mintUrl, amount);
      if (!toast) {
        paymentLog.debug('hook.payment_status.receive_created_skipped', {
          ...mintUrlLogFields(mintUrl),
          amount,
          operationId: operation.id,
          reason: 'no_receive_toast_for_mint_and_amount',
        });
        return;
      }
      paymentLog.info('hook.payment_status.receive_created_confirm_same_toast', {
        ...mintUrlLogFields(mintUrl),
        amount,
        operationId: operation.id,
      });
      paymentToasts.report(
        toast.key,
        'done',
        resultContent(toast.key, {
          ...toast.content,
          target: { type: 'receive', operationId: operation.id },
        }),
        { ids: [operation.id] }
      );
    });

    const offSendFinalized = manager.on('send:finalized', ({ mintUrl, operationId, operation }) => {
      const amount = amountToNumber(operation.amount);
      const unit = operation.unit;
      paymentLog.info('hook.payment_status.send_finalized', {
        operationId,
        ...mintUrlLogFields(mintUrl),
        amount,
      });
      if (isSwapStatusActive()) {
        paymentLog.info('hook.payment_status.suppressed_for_swap', {
          operationId,
          ...mintUrlLogFields(mintUrl),
          phase: 'send_finalized',
        });
        return;
      }
      // A payment request still being sent has no id yet, and this may be its
      // own send: the result is held for that toast until its flow binds it.
      const key = toastKey.send(operationId);
      paymentToasts.report(
        key,
        'done',
        resultContent(key, {
          kind: 'payment',
          variant: 'send',
          mintUrl,
          amount,
          unit,
          target: { type: 'send', operationId },
        }),
        { ids: [operationId], holdForGroup: 'send' }
      );
    });

    const offMeltRolledBack = manager.on('melt-op:rolled-back', ({ mintUrl, operation }) => {
      paymentLog.warn('hook.payment_status.melt_rolled_back', { error: operation.error });
      if (!('amount' in operation)) {
        paymentLog.warn('hook.payment_status.melt_rolled_back_missing_amount', {
          operationId: operation.id,
        });
        return;
      }
      const amount = amountToNumber(operation.amount);
      const unit = operation.unit;
      const quoteId =
        'quoteId' in operation && typeof operation.quoteId === 'string' ? operation.quoteId : null;
      const reason = operation.error
        ? describeError({ message: operation.error }, 'cashu').text
        : 'Payment was rolled back';
      const failed: PaymentContent = {
        kind: 'payment',
        variant: 'melt',
        mintUrl,
        amount,
        unit,
        ...(quoteId ? { target: { type: 'melt' as const, quoteId } } : {}),
      };
      const own = quoteId ? paymentToasts.get(toastKey.melt(quoteId)) : undefined;
      if (quoteId && own) {
        // Still open → it failed. Already ended → its flow said so first.
        if (own.phase === 'failed' || own.phase === 'done') {
          paymentLog.info('hook.payment_status.melt_rolled_back_deduped', { phase: own.phase });
          return;
        }
        paymentLog.error('hook.payment_status.melt_failed', { error: operation.error });
        paymentToasts.report(toastKey.melt(quoteId), 'failed', {
          ...resultContent(toastKey.melt(quoteId), failed),
          subtitle: reason,
        });
        return;
      }
      // A melt like this one already has a toast its own flow ends: the failed
      // toast `onPaymentFailed` just showed for this rollback, or a toast still
      // waiting to learn its quote. Do not stack a second toast beside it.
      const flowsOwn = paymentToasts.tracked().some(({ key, phase, content }) => {
        if (content.kind !== 'payment' || content.variant !== 'melt') return false;
        if (content.mintUrl !== mintUrl || content.amount !== amount || content.unit !== unit) {
          return false;
        }
        return phase === 'failed' || key.startsWith(toastKey.pending(''));
      });
      if (flowsOwn) {
        paymentLog.info('hook.payment_status.melt_rolled_back_deduped', { phase: 'flow_owned' });
        return;
      }
      // No toast of its own (onchain melts have none while they settle; the
      // rollback may also land after the toast closed). A rollback returns
      // funds silently otherwise — tell it. Swap legs are melts too: while the
      // unified swap toast owns the surface, stay quiet.
      if (isSwapStatusActive()) {
        paymentLog.info('hook.payment_status.suppressed_for_swap', {
          phase: 'melt_rolled_back',
        });
        return;
      }
      paymentLog.error('hook.payment_status.melt_new_failed_toast', {
        quoteId,
        ...mintUrlLogFields(mintUrl),
        amount,
        error: operation.error,
        reason: 'no_matching_toast',
      });
      paymentToasts.report(
        toastKey.melt(quoteId ?? `rolled-back-${Date.now()}`),
        'failed',
        { ...failed, subtitle: reason },
        quoteId ? { ids: [quoteId, operation.id] } : {}
      );
    });

    const offMeltFinalized = manager.on(
      'melt-op:finalized',
      ({ mintUrl, operationId, operation }) => {
        if (!('quoteId' in operation) || !('amount' in operation)) return;
        paymentLog.info('hook.payment_status.melt_finalized', {
          operationId,
          ...mintUrlLogFields(mintUrl),
          quoteId: operation.quoteId,
          amount: amountToNumber(operation.amount),
        });
        // Durable side-data (outpoint + fee) for onchain sends — fire and
        // forget; the toast flow below must not wait on it.
        void persistOnchainMeltAnnotation(
          manager,
          mintUrl,
          operation as unknown as Record<string, unknown>
        );
        if (isSwapStatusActive()) {
          paymentLog.info('hook.payment_status.suppressed_for_swap', {
            operationId,
            ...mintUrlLogFields(mintUrl),
            quoteId: operation.quoteId,
            phase: 'melt_finalized',
          });
          return;
        }
        // A melt started without its quote has a toast that does not know it
        // yet, and this may be its own: the result is held for that toast
        // until its flow binds it.
        const key = toastKey.melt(operation.quoteId);
        paymentToasts.report(
          key,
          'done',
          resultContent(key, {
            kind: 'payment',
            variant: 'melt',
            mintUrl,
            amount: amountToNumber(operation.amount),
            unit: operation.unit,
            target: { type: 'melt', quoteId: operation.quoteId },
          }),
          { ids: [operation.quoteId, operationId], holdForGroup: 'melt' }
        );
      }
    );

    return () => {
      disposed = true;
      paymentLog.debug('hook.payment_status.unsubscribing');
      offStateChanged();
      offAdded();
      offRedeemed();
      offPrReceive();
      offHistoryUpdated();
      offReceiveCreated();
      offSendFinalized();
      offMeltRolledBack();
      offMeltFinalized();
    };
  }, [manager]);
}
