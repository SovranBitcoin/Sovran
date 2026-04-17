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
import {
  sendBLEPrivateMessage,
  startBLE,
  startBLEPrivateChat,
} from 'bitchat-module';

import { useLightningOperations } from '@/features/receive/hooks/useLightningOperations';
import { useBitchatNickname } from '@/features/bitchat/hooks/useBitchatNickname';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { buildGiftWrappedDMPair } from '@/shared/lib/nostr/nip17';
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
function buildBip321(
  bolt11: string,
  opts: { label?: string; message?: string } = {}
): string {
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

async function sendNostrDM(
  ndk: NDK,
  senderPrivateKey: Uint8Array,
  recipientPublicKey: string,
  body: string
): Promise<void> {
  const { recipientWrap, senderWrap } = buildGiftWrappedDMPair({
    content: body,
    senderPrivateKey,
    recipientPublicKey,
  });
  const hydrate = (w: typeof recipientWrap): NDKEvent => {
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
  await hydrate(recipientWrap).publish();
  await hydrate(senderWrap)
    .publish()
    .catch((err: unknown) => {
      paymentLog.warn('split_bill.deliver.nostr.self_copy_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
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
      if (!group) {
        paymentLog.warn('split_bill.confirm.no_group', { groupId });
        return;
      }
      if (group.state !== 'draft') {
        paymentLog.info('split_bill.confirm.already_started', {
          groupId,
          state: group.state,
        });
        return;
      }

      paymentLog.info('split_bill.confirm.start', {
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
      for (const p of group.participants) {
        try {
          const mintOp = await requestLightningInvoice(group.mintUrl, p.amount);
          const mintQuoteId =
            (mintOp as any)?.quoteId ??
            (mintOp as any)?.quote ??
            (mintOp as any)?.id;
          const bolt11 =
            (mintOp as any)?.request ??
            (mintOp as any)?.invoice ??
            undefined;
          const expiresAt = (mintOp as any)?.expiresAt ?? undefined;

          if (mintQuoteId) {
            useSplitBillTransactionsStore
              .getState()
              .tagMintQuote(groupId, p.id, { mintQuoteId: String(mintQuoteId), bolt11, expiresAt });
          }
        } catch (err) {
          paymentLog.error('split_bill.confirm.mint_quote_failed', {
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

      // Re-read fresh participant state (now with mintQuoteId + bolt11).
      const refreshed = useSplitBillTransactionsStore.getState().getGroup(groupId);
      if (!refreshed) return;

      // 2. Deliver. Each delivery is best-effort and isolated; one failure
      //    doesn't abort the rest.
      for (const p of refreshed.participants) {
        if (p.deliveryState === 'failed') continue; // invoice failed above
        if (!p.bolt11) {
          useSplitBillTransactionsStore
            .getState()
            .markDelivered(groupId, p.id, false, 'No BOLT11 to deliver');
          continue;
        }
        const body = formatDeliveryBody(refreshed, p);

        try {
          if (p.channel === 'qr-only') {
            // Intentional: no delivery. Mark as "sent" to signal "we're done
            // handling delivery for this participant". Detail screen shows
            // the QR for manual share.
            useSplitBillTransactionsStore.getState().markDelivered(groupId, p.id, true);
            continue;
          }
          if (p.channel === 'nostr-dm' && p.pubkey) {
            const currentNdk = ndkRef.current;
            const currentKeys = keysRef.current;
            if (!currentNdk || !currentKeys?.privateKey) {
              throw new Error('Nostr DM unavailable: NDK or keys not ready');
            }
            paymentLog.info('split_bill.deliver.nostr', {
              participantId: p.id,
              pubkeyPrefix: p.pubkey.slice(0, 8),
              bodyLen: body.length,
            });
            await sendNostrDM(currentNdk, currentKeys.privateKey, p.pubkey, body);
          } else if (p.channel === 'ble-dm' && p.peerID) {
            // Mirror useBitChat's `ble-dm` bring-up exactly — the orchestrator
            // often runs immediately after the picker, before any mesh-chat
            // screen has nudged the Noise handshake, so we do the full
            // sequence here:
            //   1. `startBLE` — idempotent on native; no-op if the
            //      BitchatBLEProvider has already started the mesh.
            //   2. `startBLEPrivateChat` — triggers the lazy Noise XX
            //      handshake eagerly. Without this, `sendBLEPrivateMessage`
            //      would queue the payload on the native side and only
            //      actually transmit once a handshake happens to complete
            //      for some other reason — manifests as "message never
            //      arrives" for fresh peer pairs.
            //   3. Short yield so the handshake init packet gets on the
            //      air before we queue the first encrypted payload. BLE
            //      handshake completes in <500ms for already-connected
            //      peers; 250ms is enough headroom for the init+response
            //      round-trip to start without being blocking for the
            //      common case.
            const effectiveNick = nicknameRef.current || 'sovran';
            await startBLE(effectiveNick).catch((err) => {
              paymentLog.warn('split_bill.deliver.ble.start_failed', {
                error: err instanceof Error ? err.message : String(err),
              });
            });
            await startBLEPrivateChat(p.peerID).catch((err) => {
              paymentLog.warn('split_bill.deliver.ble.handshake_failed', {
                participantId: p.id,
                peerID: p.peerID,
                error: err instanceof Error ? err.message : String(err),
              });
            });
            await new Promise((resolve) => setTimeout(resolve, 250));
            const chunks = chunkUtf8(body, 255);
            paymentLog.info('split_bill.deliver.ble', {
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
            for (const chunk of chunks) {
              await sendBLEPrivateMessage(p.peerID, chunk, effectiveNick);
            }
          } else {
            throw new Error('Missing delivery target');
          }
          useSplitBillTransactionsStore.getState().markDelivered(groupId, p.id, true);
        } catch (err) {
          paymentLog.error('split_bill.confirm.deliver_failed', {
            groupId,
            participantId: p.id,
            channel: p.channel,
            error: err instanceof Error ? err.message : String(err),
          });
          useSplitBillTransactionsStore
            .getState()
            .markDelivered(
              groupId,
              p.id,
              false,
              err instanceof Error ? err.message : String(err)
            );
        }
      }

      useSplitBillTransactionsStore.getState().finalizeGroup(groupId);
      paymentLog.info('split_bill.confirm.done', { groupId });
    },
    [requestLightningInvoice]
  );

  /** Retry delivery for a single participant (used by the detail screen). */
  const retryDelivery = useCallback(async (groupId: string, participantId: string) => {
    const store = useSplitBillTransactionsStore.getState();
    const group = store.getGroup(groupId);
    const p = group?.participants.find((x) => x.id === participantId);
    if (!group || !p) return;
    if (!p.bolt11) return;

    paymentLog.info('split_bill.retry_delivery', { groupId, participantId, channel: p.channel });
    const body = formatDeliveryBody(group, p);
    try {
      if (p.channel === 'nostr-dm' && p.pubkey) {
        const currentNdk = ndkRef.current;
        const currentKeys = keysRef.current;
        if (!currentNdk || !currentKeys?.privateKey) {
          throw new Error('Nostr DM unavailable: NDK or keys not ready');
        }
        paymentLog.info('split_bill.retry_delivery.nostr', {
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
          paymentLog.warn('split_bill.retry_delivery.ble.handshake_failed', {
            participantId,
            peerID: p.peerID,
            error: err instanceof Error ? err.message : String(err),
          });
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
        const chunks = chunkUtf8(body, 255);
        paymentLog.info('split_bill.retry_delivery.ble', {
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
    } catch (err) {
      paymentLog.error('split_bill.retry_delivery.failed', {
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

    const tick = async () => {
      if (cancelled) return;
      try {
        const history: Array<Record<string, unknown>> = (await (manager as any).history
          ?.getPaginatedHistory?.(0, 200)) ?? [];
        const store = useSplitBillTransactionsStore.getState();
        const group = store.getGroup(groupId);
        if (!group) return;

        for (const p of group.participants) {
          if (!p.mintQuoteId) continue;
          if (p.paymentState === 'paid') continue;
          const row = history.find(
            (h) =>
              h.type === 'mint' &&
              typeof h.quoteId === 'string' &&
              h.quoteId === p.mintQuoteId
          );
          const state = row?.state as string | undefined;
          if (state === 'PAID' || state === 'ISSUED') {
            store.markPaymentPaidByQuoteId(p.mintQuoteId);
          } else if (state === 'EXPIRED') {
            store.markPaymentExpiredByQuoteId(p.mintQuoteId);
          }
        }
      } catch (err) {
        paymentLog.debug('split_bill.watcher.tick_failed', {
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
    };
  }, [manager, groupId]);
}
