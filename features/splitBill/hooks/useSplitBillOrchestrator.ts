/**
 * @fileoverview Split-Bill orchestrator.
 *
 * Given a draft `SplitBillGroup` in the store, `confirm(groupId)`:
 *   1. Transitions group → `awaiting`.
 *   2. Generates one BOLT11 Lightning mint-quote per participant by calling
 *      `requestLightningInvoice(group.mintUrl, p.amount)` for each. Every
 *      invoice mints into the USER's wallet — each participant pays their
 *      share of the bill, total sats arrive at our mint.
 *   3. Tags the quote id + bolt11 + expiresAt on each participant.
 *   4. Delivers the invoice via the participant's channel:
 *        - `nostr-dm` → NIP-17 gift-wrap (BitChatNostrBridge)
 *        - `ble-dm`   → Noise private message (BitChatBLEBridge)
 *        - `qr-only`  → skipped (detail screen shows QR)
 *      Each delivery is recorded via `markDelivered(ok/fail)` — failures
 *      don't abort the overall flow; the user can retry per-participant
 *      from the detail screen.
 *
 * Also exposes `useSplitBillPaymentWatcher(groupId)` — subscribes to coco
 * `HistoryEntry` changes and flips participants' `paymentState` to `paid`
 * when their mint quote hits ISSUED/PAID. Summary + detail screens mount
 * this so payment updates propagate live.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useManager } from '@cashu/coco-react';
import NDK, { NDKEvent, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { sendBLEPrivateMessage, startBLE, startBLEPrivateChat } from 'bitchat-module';

import { useLightningOperations } from '@/features/receive/hooks/useLightningOperations';
import { useBitchatNickname } from '@/features/bitchat/hooks/useBitchatNickname';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { buildRecipientGiftWrap, buildSenderSelfCopyWrap } from '@/shared/lib/nostr/nip17';
import { useSplitBillTransactionsStore } from '@/shared/stores/profile/splitBillTransactionsStore';
import type {
  SplitBillGroup,
  SplitBillParticipant,
} from '@/shared/stores/profile/splitBillTransactionsStore';
import { paymentLog } from '@/shared/lib/logger';

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
 * Wallets that parse BIP-321 (including Sovran's `coco-payment-ux/src/parse.ts`)
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

/**
 * Split `text` into chunks whose UTF-8 byte length is ≤ `maxBytes`.
 *
 * Upstream bitchat's `PrivateMessagePacket` encodes `content` as a TLV with a
 * 1-byte length prefix (Packets.swift, content TLV 0x01) — anything over 255
 * bytes makes `encode()` return nil and the send silently drops. We chunk at
 * the app layer and send each piece as its own DM; the recipient sees a
 * short run of consecutive bubbles in order.
 *
 * Prefers to split on the most recent `\n` within the 64-byte tail of the
 * candidate slice so a `"preface\nbitcoin:?lightning=…"` body produces one
 * bubble per line when the preface fits under the cap. Always respects
 * UTF-8 code-point boundaries (never severs a multi-byte codepoint).
 */
function chunkUtf8(text: string, maxBytes = 255): string[] {
  if (!text) return [];
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return [text];

  const chunks: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    let end = Math.min(i + maxBytes, bytes.length);
    if (end < bytes.length) {
      // Back off continuation bytes (0b10xxxxxx) to land on a codepoint boundary.
      while (end > i && (bytes[end] & 0xc0) === 0x80) end--;
      // Prefer the most recent newline in the last 64 bytes for readability.
      const floor = Math.max(i + 1, end - 64);
      for (let j = end - 1; j >= floor; j--) {
        if (bytes[j] === 0x0a) {
          end = j + 1;
          break;
        }
      }
    }
    chunks.push(decoder.decode(bytes.subarray(i, end)));
    i = end;
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Nostr DM delivery — identical to what UserMessagesScreen does for 1:1
// contact DMs (shared/lib/nostr/nip17.ts + NDK publish). By sending split-bill
// invoices through the same pipeline, the recipient sees the invoice as a
// normal chat bubble in their existing Contacts thread (the
// `bitcoin:?lightning=…` URI is auto-linkified by coco-payment-ux's parser
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
 * Each step is instrumented so `log-doctor timeline --event
 * "nostr\.(build|publish)"` breaks the crypto vs relay costs apart.
 */
async function sendNostrDM(
  ndk: NDK,
  senderPrivateKey: Uint8Array,
  recipientPublicKey: string,
  body: string
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
  setTimeout(() => {
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
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function useSplitBillOrchestrator() {
  const { requestLightningInvoice } = useLightningOperations();
  const nickname = useBitchatNickname();
  const nicknameRef = useRef(nickname);
  nicknameRef.current = nickname;

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
          const mintQuoteId =
            (mintOp as any)?.quoteId ?? (mintOp as any)?.quote ?? (mintOp as any)?.id;
          const bolt11 = (mintOp as any)?.request ?? (mintOp as any)?.invoice ?? undefined;
          const expiresAt = (mintOp as any)?.expiresAt ?? undefined;

          if (mintQuoteId) {
            useSplitBillTransactionsStore
              .getState()
              .tagMintQuote(groupId, p.id, { mintQuoteId: String(mintQuoteId), bolt11, expiresAt });
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
            await sendNostrDM(currentNdk, currentKeys.privateKey, p.pubkey, body);
          } else if (p.channel === 'ble-dm' && p.peerID) {
            // Per-peer bring-up: trigger the lazy Noise XX handshake and
            // wait a short beat for the init packet to hit the air before
            // queuing encrypted payloads. `startBLE` itself is lifted out
            // of this loop — done once before the bleWorker starts.
            //
            //   - `startBLEPrivateChat` — triggers the handshake eagerly.
            //     Without this, `sendBLEPrivateMessage` would queue the
            //     payload on the native side and only actually transmit
            //     once a handshake happens to complete for some other
            //     reason — manifests as "message never arrives" for fresh
            //     peer pairs.
            //   - 250ms sleep — so the handshake init packet gets on the
            //     air before we queue the first encrypted payload. BLE
            //     handshake completes in <500ms for already-connected
            //     peers; 250ms is enough headroom for the init+response
            //     round-trip to start without being blocking for the
            //     common case.
            const effectiveNick = nicknameRef.current || 'sovran';
            const bleHandshakeStartAt = performance.now();
            await startBLEPrivateChat(p.peerID).catch((err) => {
              flow.warn('split_bill.deliver.ble.handshake_failed', {
                participantId: p.id,
                peerID: p.peerID,
                error: err instanceof Error ? err.message : String(err),
              });
            });
            flow.debug('split_bill.deliver.ble.handshake_done', {
              participantId: p.id,
              peerID: p.peerID,
              handshake_ms: Math.round((performance.now() - bleHandshakeStartAt) * 100) / 100,
            });
            await new Promise((resolve) => setTimeout(resolve, 250));
            const chunks = chunkUtf8(body, 255);
            flow.info('split_bill.deliver.ble', {
              participantId: p.id,
              peerID: p.peerID,
              bodyLen: body.length,
              chunks: chunks.length,
              nickname: effectiveNick,
            });
            // Serial `await` is load-bearing: it preserves chunk order end
            // to end. `sendBLEPrivateMessage` returns as soon as BLEService
            // enqueues onto its internal `messageQueue` (a serial
            // DispatchQueue, BLEService.swift:428-435), which is FIFO by
            // construction, so chunk N is encrypted + broadcast before
            // chunk N+1. Noise's per-session nonce also increments
            // strictly with encrypt order, and the receiver drops any
            // out-of-order packets — so anything parallel here would risk
            // silent drops as well as scrambled bubbles.
            const chunksStartAt = performance.now();
            for (const chunk of chunks) {
              await sendBLEPrivateMessage(p.peerID, chunk, effectiveNick);
            }
            flow.debug('split_bill.deliver.ble.chunks_sent', {
              participantId: p.id,
              chunks: chunks.length,
              duration_ms: Math.round((performance.now() - chunksStartAt) * 100) / 100,
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
          const startupAt = performance.now();
          await startBLE(effectiveNick).catch((err) => {
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
        await sendNostrDM(currentNdk, currentKeys.privateKey, p.pubkey, body);
      } else if (p.channel === 'ble-dm' && p.peerID) {
        // Same bring-up sequence as the confirm path — see comments there.
        const effectiveNick = nicknameRef.current || 'sovran';
        await startBLE(effectiveNick).catch(() => undefined);
        await startBLEPrivateChat(p.peerID).catch((err) => {
          flow.warn('split_bill.retry_delivery.ble.handshake_failed', {
            participantId,
            peerID: p.peerID,
            error: err instanceof Error ? err.message : String(err),
          });
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
        const chunks = chunkUtf8(body, 255);
        flow.info('split_bill.retry_delivery.ble', {
          participantId,
          peerID: p.peerID,
          bodyLen: body.length,
          chunks: chunks.length,
        });
        for (const chunk of chunks) {
          await sendBLEPrivateMessage(p.peerID, chunk, effectiveNick);
        }
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
// Payment watcher
// ---------------------------------------------------------------------------

/**
 * Poll coco's history for paid mint-quotes belonging to this group and
 * flip participants to `paid`. Polled instead of event-subscribed because
 * coco-core's event surface varies across versions; polling the history
 * array is stable and cheap at ~every 8s. Unmounts when the screen does.
 */
export function useSplitBillPaymentWatcher(groupId?: string) {
  const manager = useManager();

  useEffect(() => {
    if (!groupId || !manager) return;

    let cancelled = false;
    let tickCount = 0;
    const watchStartAt = performance.now();
    const flow = paymentLog.child({ flowId: groupId });
    flow.info('split_bill.watcher.start', { groupId });

    const tick = async () => {
      if (cancelled) return;
      tickCount++;
      const tickStart = performance.now();
      try {
        const history = await manager.history.getPaginatedHistory(0, 200);
        const historyMs = performance.now() - tickStart;
        const store = useSplitBillTransactionsStore.getState();
        const group = store.getGroup(groupId);
        if (!group) return;

        let matched = 0;
        let paidFlipped = 0;
        let expiredFlipped = 0;
        let stillPending = 0;
        for (const p of group.participants) {
          if (!p.mintQuoteId) continue;
          if (p.paymentState === 'paid') continue;
          const row = history.find((h) => h.type === 'mint' && h.quoteId === p.mintQuoteId);
          if (row) matched++;
          // Coco's MintQuoteState is 'UNPAID' | 'PAID' | 'ISSUED' — but mints
          // may surface 'EXPIRED' via legacy or upstream paths the type does
          // not enumerate yet. Read as string so both branches stay reachable.
          const state = row?.state as string | undefined;
          if (state === 'PAID' || state === 'ISSUED') {
            store.markPaymentPaidByQuoteId(p.mintQuoteId);
            paidFlipped++;
          } else if (state === 'EXPIRED') {
            store.markPaymentExpiredByQuoteId(p.mintQuoteId);
            expiredFlipped++;
          } else {
            stillPending++;
          }
        }
        flow.debug('split_bill.watcher.tick', {
          groupId,
          tick: tickCount,
          historyRows: history.length,
          historyMs: Math.round(historyMs * 100) / 100,
          tick_ms: Math.round((performance.now() - tickStart) * 100) / 100,
          matched,
          paidFlipped,
          expiredFlipped,
          stillPending,
        });
      } catch (err) {
        flow.debug('split_bill.watcher.tick_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    // Eager initial tick, then poll every 8s.
    tick();
    const id = setInterval(tick, 8_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      flow.info('split_bill.watcher.stop', {
        groupId,
        ticks: tickCount,
        alive_ms: Math.round((performance.now() - watchStartAt) * 100) / 100,
      });
    };
  }, [manager, groupId]);
}
