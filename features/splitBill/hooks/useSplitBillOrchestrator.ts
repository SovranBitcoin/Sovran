/**
 * @fileoverview Split-Bill orchestrator.
 *
 * Given a draft `SplitBillGroup` in the store, `confirm(groupId)`:
 *   1. Transitions group → `awaiting`.
 *   2. Generates one BOLT11 Lightning mint-quote per participant by calling
 *      `requestLightningInvoice(group.mintUrl, p.amount)` for each. Every
 *      invoice mints into the USER's wallet — each participant pays their
 *      share of the bill, total sats arrive at our mint.
 *   3. Tags the quote id + bolt11 on each participant.
 *   4. Delivers the invoice via the participant's channel:
 *        - `nostr-dm` → NIP-17 gift-wrap (BitChatNostrBridge)
 *        - `ble-dm`   → Noise private message (BitChatBLEBridge)
 *        - `qr-only`  → skipped (detail screen shows QR)
 *      Each delivery is recorded via `markDelivered(ok/fail)` — failures
 *      don't abort the overall flow; the user can retry per-participant
 *      from the detail screen.
 *
 * Also exposes `useSplitBillPaymentReconciler()` — subscribes to coco's
 * `history:updated` event bus and flips participants' `paymentState` to
 * `paid`/`expired` when their mint quote hits ISSUED/PAID/EXPIRED. Mount
 * once at app root so reconciliation runs regardless of which screen the
 * user has open.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useManager } from '@cashu/coco-react';
import NDK, { NDKEvent, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { startBLE } from 'bitchat-module';

import { useBitchatProfileScope } from '@/features/bitchat/lib/profileScope';
import { useBitchatNickname } from '@/features/bitchat/hooks/useBitchatNickname';
import { sendBLEPrivateMessageChunks } from '@/features/bitchat/lib/blePrivateDelivery';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { buildRecipientGiftWrap, buildSenderSelfCopyWrap } from '@/shared/lib/nostr/nip17';
import { useSplitBillTransactionsStore } from '@/shared/stores/profile/splitBillTransactionsStore';
import type {
  SplitBillGroup,
  SplitBillParticipant,
} from '@/shared/stores/profile/splitBillTransactionsStore';
import { paymentLog } from '@/shared/lib/logger';
import { reconcileSplitBillHistoryUpdate } from '@/features/splitBill/lib/reconcileSplitBillHistoryUpdate';

// ---------------------------------------------------------------------------

/**
 * Build a BIP-321 Bitcoin URI carrying the Lightning invoice plus metadata.
 *
 * Per BIP-321:
 *   - `label` is the recipient's name (e.g. the participant nickname).
 *   - `message` is a human-readable description of the payment, not the
 *     recipient's name.
 *   - Both `label` and `message` MUST NOT appear more than once per URI.
 *
 * Wallets that parse BIP-321 (including Sovran's `colada/src/parse.ts`)
 * surface the `message` to the payer, so we put the "pay your share…" text
 * there and drop any in-band plaintext preface — the URI is the whole body.
 *
 * URLSearchParams encodes spaces as `+`; BIP-321 parsers expect `%20`, so
 * swap before returning.
 */
function buildBip321(bolt11: string, opts: { label?: string; message?: string } = {}): string {
  const params = new URLSearchParams();
  params.set('lightning', bolt11);
  if (opts.label) params.set('label', opts.label);
  if (opts.message) params.set('message', opts.message);
  return `bitcoin:?${params.toString().replace(/\+/g, '%20')}`;
}

/**
 * Format the delivery payload as a single BIP-321 URI. `label` = recipient's
 * nickname; `message` = the "pay your share of the X sat bill…" sentence so
 * the payer's wallet shows the context without us needing a separate preface
 * message in the DM thread.
 */
function formatDeliveryBody(group: SplitBillGroup, p: SplitBillParticipant): string {
  const bolt11 = p.bolt11 ?? '';
  const message = `pay your share of the ${group.totalAmount} ${group.unit} bill by paying ${p.amount} ${group.unit} split among ${group.participants.length} people`;
  return buildBip321(bolt11, {
    label: p.nickname || undefined,
    message,
  });
}

// ---------------------------------------------------------------------------
// Nostr DM delivery — identical to what UserMessagesScreen does for 1:1
// contact DMs (shared/lib/nostr/nip17.ts + NDK publish). By sending split-bill
// invoices through the same pipeline, the recipient sees the invoice as a
// normal chat bubble in their existing Contacts thread (the
// `bitcoin:?lightning=…` URI is auto-linkified by colada's parser
// and pops the pay-confirm sheet on tap). The `senderWrap` self-copy is
// best-effort — it lets the sender's own Contacts thread render the sent
// invoice; a relay-publish failure on the self-copy is logged but does not
// abort the send.
// ---------------------------------------------------------------------------

/**
 * Send a NIP-17 gift-wrapped DM. Only the recipient's wrap sits on the
 * awaited path — the sender self-copy is deferred to a background task so
 * its Schnorr + NIP-44 crypto (≈ 500-1000ms on Hermes) doesn't block the
 * orchestrator's next action.
 *
 * Loss semantics for the self-copy: `setTimeout(…, 0)` guarantees the work
 * eventually runs while the process is alive. The catch is intentional — a
 * failed self-copy publish doesn't affect the recipient's DM delivery, just
 * whether the sender sees the sent invoice in their own Contacts thread.
 *
 * `pendingTimers` is the orchestrator hook's per-instance Set of deferred
 * timer ids. The hook clears every entry on unmount so the closure (which
 * captures `senderPrivateKey: Uint8Array`) becomes unreachable for GC the
 * moment the user dismisses the flow — addresses 43.json#F-015.
 *
 * Each step is instrumented so `log-doctor timeline --event
 * "nostr\.(build|publish)"` breaks the crypto vs relay costs apart.
 */
async function sendNostrDM(
  ndk: NDK,
  senderPrivateKey: Uint8Array,
  recipientPublicKey: string,
  body: string,
  pendingTimers: Set<ReturnType<typeof setTimeout>>
): Promise<void> {
  const hydrate = (w: {
    kind: number;
    content: string;
    tags: string[][];
    created_at: number;
    pubkey: string;
    id: string;
    sig: string;
  }): NDKEvent => {
    const e = new NDKEvent(ndk);
    e.kind = w.kind;
    e.content = w.content;
    e.tags = w.tags;
    e.created_at = w.created_at;
    e.pubkey = w.pubkey;
    e.id = w.id;
    e.sig = w.sig;
    return e;
  };

  // Critical path: build + publish the recipient wrap. All subsequent
  // orchestrator work waits on this.
  const buildStart = performance.now();
  const { rumor, recipientWrap } = buildRecipientGiftWrap({
    content: body,
    senderPrivateKey,
    recipientPublicKey,
  });
  const buildMs = performance.now() - buildStart;

  const publishStart = performance.now();
  await hydrate(recipientWrap).publish();
  const publishMs = performance.now() - publishStart;

  paymentLog.debug('split_bill.deliver.nostr.timing', {
    recipientPrefix: recipientPublicKey.slice(0, 8),
    bodyLen: body.length,
    build_ms: Math.round(buildMs * 100) / 100,
    publish_ms: Math.round(publishMs * 100) / 100,
  });

  // Deferred self-copy — runs after the orchestrator's microtask queue
  // drains and the UI gets a paint cycle. setTimeout(…, 0) is chosen over
  // queueMicrotask so the event loop can process UI touches / timers /
  // pending inbound DM decrypts before we kick off ~1s of crypto.
  const timerId: ReturnType<typeof setTimeout> = setTimeout(() => {
    pendingTimers.delete(timerId);
    const selfBuildStart = performance.now();
    let senderWrap;
    try {
      senderWrap = buildSenderSelfCopyWrap({ rumor, senderPrivateKey });
    } catch (err: unknown) {
      paymentLog.warn('split_bill.deliver.nostr.self_copy_build_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const selfBuildMs = performance.now() - selfBuildStart;
    const selfPublishStart = performance.now();
    hydrate(senderWrap)
      .publish()
      .then(() => {
        paymentLog.debug('split_bill.deliver.nostr.self_copy_sent', {
          recipientPrefix: recipientPublicKey.slice(0, 8),
          build_ms: Math.round(selfBuildMs * 100) / 100,
          publish_ms: Math.round((performance.now() - selfPublishStart) * 100) / 100,
        });
      })
      .catch((err: unknown) => {
        paymentLog.warn('split_bill.deliver.nostr.self_copy_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, 0);
  pendingTimers.add(timerId);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function useSplitBillOrchestrator() {
  const manager = useManager();
  const requestLightningInvoice = useCallback(
    (mintUrl: string, amount: number) =>
      manager.ops.mint.prepare({ mintUrl, amount, method: 'bolt11' }),
    [manager]
  );
  const nickname = useBitchatNickname();
  const nicknameRef = useRef(nickname);
  nicknameRef.current = nickname;
  const bitchatProfileScope = useBitchatProfileScope();
  const bitchatProfileScopeRef = useRef(bitchatProfileScope);
  bitchatProfileScopeRef.current = bitchatProfileScope;

  // NDK + main Nostr private key — same sources UserMessagesScreen uses
  // for its DM send. Held behind refs so `confirm` / `retryDelivery` can
  // close over them without needing new `useCallback` deps on every
  // render.
  const { ndk } = useNDK();
  const { keys } = useNostrKeysContext();
  const ndkRef = useRef(ndk);
  const keysRef = useRef(keys);
  useEffect(() => {
    ndkRef.current = ndk;
  }, [ndk]);
  useEffect(() => {
    keysRef.current = keys;
  }, [keys]);

  // Pending self-copy timer ids — see sendNostrDM. Cleared on unmount so a
  // dismissed flow doesn't keep `senderPrivateKey` reachable for ~1s.
  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    const timers = pendingTimersRef.current;
    return () => {
      for (const id of timers) clearTimeout(id);
      timers.clear();
    };
  }, []);

  const confirm = useCallback(
    async (groupId: string) => {
      const store = useSplitBillTransactionsStore.getState();
      const group = store.getGroup(groupId);
      // Flow-scoped logger: `flowId: groupId` lets `log-doctor flows` group
      // every event from this confirm across mint-quote + delivery +
      // finalize phases into one trace row.
      const flow = paymentLog.child({ flowId: groupId });
      if (!group) {
        flow.warn('split_bill.confirm.no_group', { groupId });
        return;
      }
      if (group.state !== 'draft') {
        flow.info('split_bill.confirm.already_started', {
          groupId,
          state: group.state,
        });
        return;
      }

      const span = flow.startSpan('split_bill.confirm', {
        groupId,
        mintUrl: group.mintUrl,
        total: group.totalAmount,
        participants: group.participants.length,
      });
      flow.info('split_bill.confirm.start', {
        groupId,
        mintUrl: group.mintUrl,
        total: group.totalAmount,
        participants: group.participants.length,
      });

      store.transitionGroup(groupId, 'awaiting');

      // 1. Generate mint quotes sequentially. Parallel would be faster but
      //    coco's history index has write-contention that can occasionally
      //    misorder rows; sequential is simpler and few-participant splits
      //    rarely exceed a handful of calls.
      const quotePhaseStart = performance.now();
      let quoteSuccessCount = 0;
      let quoteFailureCount = 0;
      for (const p of group.participants) {
        if (p.source === 'self') {
          // Self-participants track only as split-math entries — no
          // invoice, no relay round-trip. Payment is implicit (it's the
          // user's own money) and the delivery loop below marks them
          // delivered + paid immediately.
          flow.debug('split_bill.confirm.mint_quote.skip_self', {
            groupId,
            participantId: p.id,
          });
          continue;
        }
        try {
          const mintOp = await flow.timed(
            'split_bill.confirm.mint_quote',
            () => requestLightningInvoice(group.mintUrl, p.amount),
            {
              params: { groupId, participantId: p.id, amount: p.amount },
              warnThresholdMs: 3000,
            }
          );
          const { quoteId: mintQuoteId, request: bolt11 } = mintOp;

          if (mintQuoteId) {
            useSplitBillTransactionsStore
              .getState()
              .tagMintQuote(groupId, p.id, { mintQuoteId, bolt11 });
            quoteSuccessCount++;
          }
        } catch (err) {
          quoteFailureCount++;
          flow.error('split_bill.confirm.mint_quote_failed', {
            groupId,
            participantId: p.id,
            error: err instanceof Error ? err.message : String(err),
          });
          // Delivery can't succeed without an invoice — mark as failed.
          useSplitBillTransactionsStore
            .getState()
            .markDelivered(groupId, p.id, false, 'Failed to generate invoice');
          continue;
        }
      }
      flow.info('split_bill.confirm.quote_phase_done', {
        groupId,
        success: quoteSuccessCount,
        failure: quoteFailureCount,
        duration_ms: Math.round((performance.now() - quotePhaseStart) * 100) / 100,
      });

      // Re-read fresh participant state (now with mintQuoteId + bolt11).
      const refreshed = useSplitBillTransactionsStore.getState().getGroup(groupId);
      if (!refreshed) {
        span.end({ outcome: 'aborted_post_quote' });
        flow.info('flow.end', { groupId, outcome: 'aborted_post_quote' });
        return;
      }

      // 2. Deliver. Each delivery is best-effort and isolated; one failure
      //    doesn't abort the rest.
      //
      //    Channel scheduling:
      //      - BLE: sequential. The radio is shared across peers and Noise
      //        sessions have strictly-incrementing per-session nonces — the
      //        receiver drops out-of-order packets, so two parallel BLE
      //        sends to different peers can race each other's handshakes.
      //      - Nostr DMs: parallel. Each gift-wrap publish is independent
      //        (separate NDKEvent signed by an ephemeral key per recipient);
      //        relay writes have no shared state. Previously sequential for
      //        no good reason — the main bottleneck in the flow.
      //      - QR-only: parallel with Nostr. No network work, just a store
      //        write.
      //    BLE "worker" runs concurrently with the Nostr batch, so even a
      //    slow handshake doesn't block relay sends.
      const deliveryPhaseStart = performance.now();
      type DeliveryOutcome = 'delivered' | 'failed';

      const deliverOne = async (p: SplitBillParticipant): Promise<DeliveryOutcome> => {
        // Self-participants short-circuit the entire delivery pipeline.
        // No invoice exists (skipped above in the quote loop); no channel
        // to deliver over; payment is implicit. Mark delivered + paid so
        // the group can finalize as normal.
        if (p.source === 'self') {
          const store = useSplitBillTransactionsStore.getState();
          store.markDelivered(groupId, p.id, true);
          store.markPaymentPaid(groupId, p.id);
          flow.debug('split_bill.deliver.self', {
            groupId,
            participantId: p.id,
            pubkeyPrefix: p.pubkey?.slice(0, 8),
          });
          return 'delivered';
        }
        if (p.deliveryState === 'failed') return 'failed'; // invoice failed above
        if (!p.bolt11) {
          useSplitBillTransactionsStore
            .getState()
            .markDelivered(groupId, p.id, false, 'No BOLT11 to deliver');
          return 'failed';
        }
        const body = formatDeliveryBody(refreshed, p);
        const deliverSpan = flow.startSpan('split_bill.confirm.deliver', {
          groupId,
          participantId: p.id,
          channel: p.channel,
          bodyLen: body.length,
        });

        try {
          if (p.channel === 'qr-only') {
            // Intentional: no delivery. Mark as "sent" to signal "we're done
            // handling delivery for this participant". Detail screen shows
            // the QR for manual share.
            useSplitBillTransactionsStore.getState().markDelivered(groupId, p.id, true);
            deliverSpan.end({ outcome: 'qr_only' });
            return 'delivered';
          }
          if (p.channel === 'nostr-dm' && p.pubkey) {
            const currentNdk = ndkRef.current;
            const currentKeys = keysRef.current;
            if (!currentNdk || !currentKeys?.privateKey) {
              throw new Error('Nostr DM unavailable: NDK or keys not ready');
            }
            flow.info('split_bill.deliver.nostr', {
              participantId: p.id,
              pubkeyPrefix: p.pubkey.slice(0, 8),
              bodyLen: body.length,
            });
            await sendNostrDM(
              currentNdk,
              currentKeys.privateKey,
              p.pubkey,
              body,
              pendingTimersRef.current
            );
          } else if (p.channel === 'ble-dm' && p.peerID) {
            const effectiveNick = nicknameRef.current || 'sovran';
            const result = await sendBLEPrivateMessageChunks({
              peerID: p.peerID,
              content: body,
              nickname: effectiveNick,
              profileScope: bitchatProfileScopeRef.current,
              messageIdPrefix: 'split-bill',
            });
            if (result.handshakeError) {
              flow.warn('split_bill.deliver.ble.handshake_failed', {
                participantId: p.id,
                peerID: p.peerID,
                error: result.handshakeError,
              });
            }
            flow.debug('split_bill.deliver.ble.handshake_done', {
              participantId: p.id,
              peerID: p.peerID,
              handshake_ms: Math.round(result.handshakeMs * 100) / 100,
            });
            flow.info('split_bill.deliver.ble', {
              participantId: p.id,
              peerID: p.peerID,
              bodyLen: body.length,
              chunks: result.chunks,
              nickname: effectiveNick,
            });
            flow.debug('split_bill.deliver.ble.chunks_sent', {
              participantId: p.id,
              chunks: result.chunks,
              duration_ms: Math.round(result.sendMs * 100) / 100,
            });
          } else {
            throw new Error('Missing delivery target');
          }
          useSplitBillTransactionsStore.getState().markDelivered(groupId, p.id, true);
          deliverSpan.end({ outcome: 'delivered' });
          return 'delivered';
        } catch (err) {
          deliverSpan.end({
            outcome: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
          flow.error('split_bill.confirm.deliver_failed', {
            groupId,
            participantId: p.id,
            channel: p.channel,
            error: err instanceof Error ? err.message : String(err),
          });
          useSplitBillTransactionsStore
            .getState()
            .markDelivered(groupId, p.id, false, err instanceof Error ? err.message : String(err));
          return 'failed';
        }
      };

      const bleParticipants = refreshed.participants.filter((p) => p.channel === 'ble-dm');
      const nonBleParticipants = refreshed.participants.filter((p) => p.channel !== 'ble-dm');

      flow.info('split_bill.confirm.deliver_phase_start', {
        groupId,
        ble: bleParticipants.length,
        nonBle: nonBleParticipants.length,
      });

      // BLE worker — sequential per-peer handshake + send.
      //
      // `startBLE` is idempotent (no-op if the BitchatBLEProvider has
      // already started the mesh); we call it once up front instead of
      // per-peer so we don't pay its native-bridge round-trip N times.
      const bleWorker = (async (): Promise<DeliveryOutcome[]> => {
        if (bleParticipants.length > 0) {
          const effectiveNick = nicknameRef.current || 'sovran';
          const profileScope = bitchatProfileScopeRef.current;
          if (!profileScope) {
            flow.warn('split_bill.deliver.ble.no_profile_scope');
            for (const p of bleParticipants) {
              useSplitBillTransactionsStore
                .getState()
                .markDelivered(groupId, p.id, false, 'BitChat profile scope unavailable');
            }
            return bleParticipants.map(() => 'failed' as const);
          }
          const startupAt = performance.now();
          await startBLE(effectiveNick, profileScope).catch((err) => {
            flow.warn('split_bill.deliver.ble.start_failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          });
          flow.debug('split_bill.deliver.ble.startup_done', {
            peers: bleParticipants.length,
            startup_ms: Math.round((performance.now() - startupAt) * 100) / 100,
          });
        }
        const out: DeliveryOutcome[] = [];
        for (const p of bleParticipants) out.push(await deliverOne(p));
        return out;
      })();

      // Nostr + QR — fully parallel, no cross-participant shared state.
      const nonBleWorker = Promise.all(nonBleParticipants.map((p) => deliverOne(p)));

      const [bleOutcomes, nonBleOutcomes] = await Promise.all([bleWorker, nonBleWorker]);
      const deliveredCount = [...bleOutcomes, ...nonBleOutcomes].filter(
        (o) => o === 'delivered'
      ).length;
      const deliveryFailureCount = [...bleOutcomes, ...nonBleOutcomes].length - deliveredCount;

      flow.info('split_bill.confirm.deliver_phase_done', {
        groupId,
        delivered: deliveredCount,
        failed: deliveryFailureCount,
        ble: bleOutcomes.length,
        nonBle: nonBleOutcomes.length,
        duration_ms: Math.round((performance.now() - deliveryPhaseStart) * 100) / 100,
      });

      useSplitBillTransactionsStore.getState().finalizeGroup(groupId);
      span.end({
        outcome: 'finalized',
        quoteSuccess: quoteSuccessCount,
        quoteFailure: quoteFailureCount,
        delivered: deliveredCount,
        deliveryFailure: deliveryFailureCount,
      });
      flow.info('split_bill.confirm.done', { groupId });
      flow.info('flow.end', {
        groupId,
        outcome: 'finalized',
        quoteSuccess: quoteSuccessCount,
        quoteFailure: quoteFailureCount,
        delivered: deliveredCount,
        deliveryFailure: deliveryFailureCount,
      });
    },
    [requestLightningInvoice]
  );

  /** Retry delivery for a single participant (used by the detail screen). */
  const retryDelivery = useCallback(async (groupId: string, participantId: string) => {
    const store = useSplitBillTransactionsStore.getState();
    const group = store.getGroup(groupId);
    const p = group?.participants.find((x) => x.id === participantId);
    const flow = paymentLog.child({ flowId: groupId });
    if (!group || !p) return;
    if (!p.bolt11) return;

    const span = flow.startSpan('split_bill.retry_delivery', {
      groupId,
      participantId,
      channel: p.channel,
    });
    flow.info('split_bill.retry_delivery', { groupId, participantId, channel: p.channel });
    const body = formatDeliveryBody(group, p);
    try {
      if (p.channel === 'nostr-dm' && p.pubkey) {
        const currentNdk = ndkRef.current;
        const currentKeys = keysRef.current;
        if (!currentNdk || !currentKeys?.privateKey) {
          throw new Error('Nostr DM unavailable: NDK or keys not ready');
        }
        flow.info('split_bill.retry_delivery.nostr', {
          participantId,
          pubkeyPrefix: p.pubkey.slice(0, 8),
          bodyLen: body.length,
        });
        await sendNostrDM(
          currentNdk,
          currentKeys.privateKey,
          p.pubkey,
          body,
          pendingTimersRef.current
        );
      } else if (p.channel === 'ble-dm' && p.peerID) {
        // Same bring-up sequence as the confirm path — see comments there.
        const effectiveNick = nicknameRef.current || 'sovran';
        const profileScope = bitchatProfileScopeRef.current;
        if (!profileScope) {
          throw new Error('BitChat profile scope unavailable');
        }
        const result = await sendBLEPrivateMessageChunks({
          peerID: p.peerID,
          content: body,
          nickname: effectiveNick,
          profileScope,
          messageIdPrefix: 'split-bill',
        });
        if (result.handshakeError) {
          flow.warn('split_bill.retry_delivery.ble.handshake_failed', {
            participantId,
            peerID: p.peerID,
            error: result.handshakeError,
          });
        }
        flow.info('split_bill.retry_delivery.ble', {
          participantId,
          peerID: p.peerID,
          bodyLen: body.length,
          chunks: result.chunks,
        });
      } else {
        throw new Error('QR-only: no delivery channel');
      }
      store.markDelivered(groupId, participantId, true);
      span.end({ outcome: 'delivered' });
    } catch (err) {
      span.end({ outcome: 'failed', error: err instanceof Error ? err.message : String(err) });
      flow.error('split_bill.retry_delivery.failed', {
        groupId,
        participantId,
        error: err instanceof Error ? err.message : String(err),
      });
      store.markDelivered(
        groupId,
        participantId,
        false,
        err instanceof Error ? err.message : String(err)
      );
    }
  }, []);

  return { confirm, retryDelivery };
}

// ---------------------------------------------------------------------------
// Payment reconciler — event-driven, app-root scope.
// ---------------------------------------------------------------------------

/**
 * Subscribe to coco's `history:updated` event bus and flip split-bill
 * participants to `paid`/`expired` when their tracked mint quote reaches
 * a terminal state. Mount once at app root (`<SplitBillPaymentReconciler />`
 * in `app/_layout.tsx`) — runs regardless of which screen is foregrounded.
 *
 * The reverse-index `quoteIdToSplitBill` makes the per-event lookup O(1)
 * and side-steps the previous polling watcher's three failure modes:
 *   - state never reconciled when no split-bill screen was mounted (43.json#F-002)
 *   - a participant's quote outside the most-recent-200-row page never
 *     matched (43.json#F-007)
 *   - 8s polling kept ticking when the app was backgrounded (43.json#F-013)
 *
 * Pattern matches the other 3 in-tree consumers of this event:
 * `useHistoryWithMelts`, `useHistoryEntry`, `usePaymentStatusListener`.
 */
export function useSplitBillPaymentReconciler() {
  const manager = useManager();

  useEffect(() => {
    if (!manager) return;
    paymentLog.info('split_bill.reconciler.start');

    const off = manager.on('history:updated', ({ entry }) => {
      const store = useSplitBillTransactionsStore.getState();
      const outcome = reconcileSplitBillHistoryUpdate(entry, store);
      if (outcome !== 'ignored') {
        paymentLog.info('split_bill.reconciler.flip', {
          quoteId: (entry as { quoteId?: string }).quoteId,
          outcome,
        });
      }
    });

    return () => {
      off();
      paymentLog.info('split_bill.reconciler.stop');
    };
  }, [manager]);
}
