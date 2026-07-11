/**
 * Subscribes to coco events for payment status.
 * Receive (mint): mint-quote:updated (PAID) or mint-op:pending (quote PAID) → mint-op:finalized.
 * Receive (ecash): toast shown on redeem button → receive:created updates to confirmed.
 * Send: send:finalized confirms an active send/payment-request toast when present,
 * otherwise shows the standard send confirmation toast.
 * Melt: toast shown on confirm button → melt-op:finalized updates to confirmed.
 */

import { useEffect } from 'react';

import { useManagerContext } from '@cashu/coco-react';

import {
  annotationKey,
  reusableQuoteKey,
  rotateReusableMintQuote,
  rotateStandingPaymentRequest,
  standingPaymentRequestKey,
} from 'wallet';
import { paymentStatusPopup } from '@/shared/lib/popup';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { isSwapStatusActive } from '@/shared/stores/runtime/swapStatusStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { paymentLog } from '@/shared/lib/logger';

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

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

function activeMintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    activeHasMintUrl: !!mintUrl,
    activeMintUrlLength: mintUrl?.length ?? 0,
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

function showConfirmedReceiveEcashToast(input: {
  id: string;
  mintUrl: string;
  amount: number;
  unit: string;
  receiveEntryId?: string;
  source: 'history_updated_waiting' | 'receive_finalized_waiting';
}): void {
  const { id, mintUrl, amount, unit, receiveEntryId, source } = input;
  const active = usePaymentStatusStore.getState().active;
  paymentLog.info('hook.payment_status.receive_waiting_finalized_new_toast', {
    id,
    ...mintUrlLogFields(mintUrl),
    amount,
    unit,
    receiveEntryId: receiveEntryId ?? null,
    source,
    previousActiveId: active?.id ?? null,
    previousActiveState: active?.state ?? null,
    toastPolicy: 'mount_new_success_toast_after_waiting_warning',
  });
  usePaymentStatusStore.getState().setActive({
    variant: 'receive-ecash',
    id,
    mintUrl,
    amount,
    unit,
    state: 'confirmed',
    ...(receiveEntryId ? { receiveEntryId } : {}),
  });
  paymentStatusPopup({
    variant: 'receive-ecash',
    id,
    mintUrl,
    amount,
    unit,
    ...(receiveEntryId ? { receiveEntryId } : {}),
  });
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
        // SwapStatusToast owns the user-facing surface for the duration.
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

        const existingActive = usePaymentStatusStore.getState().active;
        const isDuplicate = existingActive?.variant === 'receive' && existingActive.id === quoteId;

        paymentLog.info('hook.payment_status.receive_processing', {
          quoteId,
          ...mintUrlLogFields(mintUrl),
          amount,
          unit,
          isDuplicate,
        });
        usePaymentStatusStore.getState().setActive({
          variant: 'receive',
          id: quoteId,
          mintUrl,
          amount,
          unit,
          state: 'processing',
        });

        if (isDuplicate) {
          paymentLog.info('hook.payment_status.receive_popup_suppressed', {
            quoteId,
            ...mintUrlLogFields(mintUrl),
            reason: 'already_active',
          });
          return;
        }

        paymentStatusPopup({ variant: 'receive', id: quoteId, mintUrl, amount, unit });
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
      void (async () => {
        if (disposed) return;
        // v2 moved remote-state observation off the operation onto the
        // canonical quote row — fetch it for the PAID check + NPC freshness.
        let state: string | undefined;
        let lastObservedRemoteStateAt: number | undefined;
        try {
          const quote = await manager.quotes.mint.get({ mintUrl, quoteId });
          if (disposed) return;
          state = quote?.state ?? quote?.lastObservedRemoteState;
          lastObservedRemoteStateAt = quote?.lastObservedRemoteStateAt;
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

        const existingActive = usePaymentStatusStore.getState().active;
        const isDuplicate = existingActive?.variant === 'receive' && existingActive.id === quoteId;

        paymentLog.info('hook.payment_status.npc_receive_processing', {
          quoteId,
          ...mintUrlLogFields(mintUrl),
          amount,
          unit,
          isDuplicate,
        });
        usePaymentStatusStore.getState().setActive({
          variant: 'receive',
          id: quoteId,
          mintUrl,
          amount,
          unit,
          state: 'processing',
        });

        if (isDuplicate) {
          paymentLog.info('hook.payment_status.receive_popup_suppressed', {
            quoteId,
            ...mintUrlLogFields(mintUrl),
            reason: 'already_active',
          });
          return;
        }

        paymentStatusPopup({ variant: 'receive', id: quoteId, mintUrl, amount, unit });
      })();
    });

    const offRedeemed = manager.on('mint-op:finalized', ({ mintUrl, operationId, operation }) => {
      // FinalizedMintOperation always carries quoteId; init shouldn't reach finalize,
      // but narrow defensively to satisfy the union and keep operationId as a fallback
      // for any future variant that lacks a quoteId.
      const quoteId = operation.state === 'init' ? operationId : operation.quoteId;
      paymentLog.info('hook.payment_status.mint_quote_redeemed', { operationId, quoteId });
      const store = usePaymentStatusStore.getState();
      const hadMatchingActive = store.active?.id === quoteId;
      store.setConfirmed(quoteId);

      // Onchain address-reuse policy (mirrors P2PK rotation-on-receive): a
      // deposit that lands on the STANDING onchain address retires it — the
      // next payer gets a fresh address. Fixed-amount quotes are one-offs
      // and never match the recorded standing id, so they don't rotate
      // anything. The old quote stays pending in coco, so late payments to
      // the retired address still auto-mint.
      if (operation.state !== 'init' && operation.method === 'onchain') {
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
      if (!hadMatchingActive && operation.state !== 'init' && operation.method !== 'bolt11') {
        if (isSwapStatusActive()) return;
        const amount = amountToNumber(operation.amount);
        const unit = operation.unit;
        paymentLog.info('hook.payment_status.reusable_deposit_confirmed', {
          quoteId,
          method: operation.method,
          ...mintUrlLogFields(mintUrl),
          amount,
          unit,
        });
        usePaymentStatusStore.getState().setActive({
          variant: 'receive',
          id: quoteId,
          mintUrl,
          amount,
          unit,
          state: 'confirmed',
        });
        paymentStatusPopup({ variant: 'receive', id: quoteId, mintUrl, amount, unit });
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
      usePaymentStatusStore.getState().setActive({
        variant: 'receive',
        id: op.id,
        mintUrl,
        amount,
        unit: op.unit,
        state: 'confirmed',
      });
      paymentStatusPopup({ variant: 'receive', id: op.id, mintUrl, amount, unit: op.unit });

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
          void (async () => {
            try {
              const trusted = await manager.mint.getAllTrustedMints();
              await rotateStandingPaymentRequest(
                manager,
                { unit: op.unit, mints: trusted.map((m) => m.mintUrl).slice(0, 5) },
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
          })();
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
      const store = usePaymentStatusStore.getState();
      const active = store.active;
      const amount = amountToNumber(entry.amount);
      if (
        !active ||
        active.variant !== 'receive-ecash' ||
        active.mintUrl !== mintUrl ||
        active.amount !== amount ||
        active.receiveEntryId ||
        !entry.id
      ) {
        paymentLog.debug('hook.payment_status.receive_entry_link_skipped', {
          ...mintUrlLogFields(mintUrl),
          amount,
          entryId: entry.id ?? null,
          activeId: active?.id ?? null,
          activeVariant: active?.variant ?? null,
          ...activeMintUrlLogFields(active?.mintUrl),
          activeAmount: active?.amount ?? null,
          activeState: active?.state ?? null,
          hasReceiveEntryId: !!active?.receiveEntryId,
          reason: !active
            ? 'no_active'
            : active.variant !== 'receive-ecash'
              ? 'active_variant_mismatch'
              : active.mintUrl !== mintUrl
                ? 'mint_mismatch'
                : active.amount !== amount
                  ? 'amount_mismatch'
                  : active.receiveEntryId
                    ? 'already_linked'
                    : 'entry_missing_id',
        });
        return;
      }
      paymentLog.info('hook.payment_status.receive_entry_linked', {
        ...mintUrlLogFields(mintUrl),
        amount,
        entryId: entry.id,
        from: active.state,
      });

      if (active.state === 'waiting') {
        showConfirmedReceiveEcashToast({
          id: entry.id,
          mintUrl,
          amount,
          unit: active.unit,
          receiveEntryId: entry.id,
          source: 'history_updated_waiting',
        });
        return;
      }

      paymentLog.info('hook.payment_status.receive_entry_confirm_same_toast', {
        id: active.id,
        ...mintUrlLogFields(mintUrl),
        amount,
        receiveEntryId: entry.id,
        from: active.state,
      });
      store.setConfirmed(active.id, { receiveEntryId: entry.id });
    });

    const offReceiveCreated = manager.on('receive-op:finalized', ({ mintUrl, operation }) => {
      const amount = amountToNumber(operation.amount);
      paymentLog.info('hook.payment_status.receive_created', {
        ...mintUrlLogFields(mintUrl),
        amount,
        operationId: operation.id,
      });
      // Transition the toast to 'confirmed' even if history:updated
      // hasn't fired yet — receiveEntryId may arrive a tick later.
      const store = usePaymentStatusStore.getState();
      const active = store.active;
      if (
        active?.variant === 'receive-ecash' &&
        active.mintUrl === mintUrl &&
        active.amount === amount
      ) {
        if (active.state === 'waiting') {
          showConfirmedReceiveEcashToast({
            id: operation.id,
            mintUrl,
            amount,
            unit: operation.unit,
            source: 'receive_finalized_waiting',
          });
          return;
        }
        paymentLog.info('hook.payment_status.receive_created_confirm_same_toast', {
          id: active.id,
          ...mintUrlLogFields(mintUrl),
          amount,
          from: active.state,
          operationId: operation.id,
        });
        store.setConfirmed(active.id);
      } else {
        paymentLog.debug('hook.payment_status.receive_created_skipped', {
          ...mintUrlLogFields(mintUrl),
          amount,
          operationId: operation.id,
          activeId: active?.id ?? null,
          activeVariant: active?.variant ?? null,
          ...activeMintUrlLogFields(active?.mintUrl),
          activeAmount: active?.amount ?? null,
          activeState: active?.state ?? null,
          reason: !active
            ? 'no_active'
            : active.variant !== 'receive-ecash'
              ? 'active_variant_mismatch'
              : active.mintUrl !== mintUrl
                ? 'mint_mismatch'
                : 'amount_mismatch',
        });
      }
    });

    const offSendFinalized = manager.on('send:finalized', ({ mintUrl, operationId, operation }) => {
      const amount = amountToNumber(operation.amount);
      const unit = 'sat';
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
      const store = usePaymentStatusStore.getState();
      const hadPending =
        (store.active?.id === operationId &&
          (store.active.variant === 'send' || store.active.variant === 'payment-request')) ||
        (store.active?.variant === 'payment-request' &&
          (store.active?.state === 'processing' || store.active?.state === 'delivered'));

      if (hadPending) {
        paymentLog.info('hook.payment_status.send_confirm_same_toast', {
          operationId,
          activeId: store.active?.id ?? null,
          activeVariant: store.active?.variant ?? null,
          activeState: store.active?.state ?? null,
        });
        store.setConfirmed(store.active!.id, { operationId });
        return;
      }

      paymentLog.info('hook.payment_status.send_new_success_toast', {
        operationId,
        ...mintUrlLogFields(mintUrl),
        amount,
        unit,
        reason: 'no_matching_active_toast',
      });
      store.setActive({
        variant: 'send',
        id: operationId,
        mintUrl,
        amount,
        unit,
        state: 'confirmed',
      });

      paymentStatusPopup({ variant: 'send', id: operationId, mintUrl, amount, unit });
    });

    const offMeltRolledBack = manager.on('melt-op:rolled-back', ({ mintUrl, operation }) => {
      paymentLog.warn('hook.payment_status.melt_rolled_back', { error: operation.error });
      if (!('amount' in operation)) {
        paymentLog.warn('hook.payment_status.melt_rolled_back_missing_amount', {
          operationId: operation.id,
        });
        return;
      }
      const store = usePaymentStatusStore.getState();
      const amount = amountToNumber(operation.amount);
      const unit = operation.unit;
      const activeMatches =
        store.active?.variant === 'melt' &&
        store.active.mintUrl === mintUrl &&
        store.active.amount === amount &&
        store.active.unit === unit;
      if (activeMatches && store.active?.state === 'processing') {
        paymentLog.error('hook.payment_status.melt_failed', {
          id: store.active.id,
          error: operation.error,
        });
        store.setFailed(store.active.id, new Error(operation.error ?? 'Payment was rolled back'));
        return;
      }
      // Another melt toast already owns the surface (e.g. the fresh failed
      // toast onPaymentFailed just created for this same rollback) — don't
      // stack a duplicate.
      if (activeMatches) {
        paymentLog.info('hook.payment_status.melt_rolled_back_deduped', {
          activeId: store.active?.id ?? null,
          activeState: store.active?.state ?? null,
        });
        return;
      }
      // No active processing toast (onchain melts suppress it; the rollback
      // may also land after the toast dismissed). A rollback returns funds
      // silently otherwise — surface a fresh failed toast. Swap legs are
      // melts too: while the unified swap toast owns the surface, stay quiet.
      if (isSwapStatusActive()) {
        paymentLog.info('hook.payment_status.suppressed_for_swap', {
          phase: 'melt_rolled_back',
        });
        return;
      }
      const quoteId =
        'quoteId' in operation && typeof operation.quoteId === 'string' ? operation.quoteId : null;
      const id = quoteId ?? `melt-rolled-back-${Date.now()}`;
      paymentLog.error('hook.payment_status.melt_new_failed_toast', {
        quoteId,
        ...mintUrlLogFields(mintUrl),
        amount,
        error: operation.error,
        reason: 'no_matching_active_toast',
      });
      store.setActive({
        variant: 'melt',
        id,
        mintUrl,
        amount,
        unit,
        state: 'failed',
        errorMessage: operation.error ?? 'Payment was rolled back',
      });
      paymentStatusPopup({ variant: 'melt', id, mintUrl, amount, unit });
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
        const store = usePaymentStatusStore.getState();
        // Match by variant, not quoteId — the machine's onPaymentProcessing
        // uses a timestamp-based ID that won't match the real quoteId.
        const hadActive =
          store.active?.variant === 'melt' &&
          (store.active?.state === 'processing' || store.active?.state === 'confirmed');

        if (hadActive) {
          // Still processing → confirm. Already confirmed → just merge operationId for View button.
          paymentLog.info('hook.payment_status.melt_confirm_same_toast', {
            operationId,
            quoteId: operation.quoteId,
            activeId: store.active?.id ?? null,
            activeState: store.active?.state ?? null,
          });
          store.setConfirmed(store.active!.id, { operationId });
        } else {
          // Background melt (no active toast) — show new confirmed toast
          const amount = amountToNumber(operation.amount);
          const unit = 'sat';
          paymentLog.info('hook.payment_status.melt_new_success_toast', {
            operationId,
            quoteId: operation.quoteId,
            ...mintUrlLogFields(mintUrl),
            amount,
            unit,
            reason: 'no_matching_active_toast',
          });
          store.setActive({
            variant: 'melt',
            id: operation.quoteId,
            mintUrl,
            amount,
            unit,
            state: 'confirmed',
          });

          paymentStatusPopup({
            variant: 'melt',
            id: operation.quoteId,
            mintUrl,
            amount,
            unit,
            operationId,
          });
        }
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
