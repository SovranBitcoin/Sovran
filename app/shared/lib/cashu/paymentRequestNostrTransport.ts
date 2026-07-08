/**
 * Nostr transport for coco's NUT-18 payment-request RECEIVE pipeline.
 *
 * coco core ships the whole receive side (durable operations, claim attempts,
 * dedupe, crash recovery) but transports are bring-your-own: this plugin
 * registers the `'nostr'` handler that
 *
 *   1. contributes the transport block embedded in the encoded request —
 *      `{ type: 'nostr', target: <nprofile>, tags: [['n','17']] }` per
 *      NUT-18's Nostr transport (senders deliver a PaymentRequestPayload as
 *      a NIP-17 gift-wrapped DM), and
 *   2. while any request operation is ACTIVE, watches the viewer's gift-wrap
 *      inbox for NUT-18 payloads via TWO paths sharing one unwrap→ingest body
 *      (`handleEnvelope`): a LIVE relay subscription (`subscribeDmEnvelopes`) so
 *      a paid request is claimed the instant the wrap arrives, plus a 15s poll
 *      (nagg DM index → relay floor) as the offline/reconnect backstop. Each
 *      kind-1059 envelope is unwrapped and NUT-18-looking rumor contents fed to
 *      `paymentRequestReceiveService.ingestPayload` with the wrap event id as
 *      `transportMessageId` (coco's idempotency key, so poll+live can't
 *      double-claim) and the rumor author as `senderPubkey`.
 *
 * Registration rides the coco plugin seam (ServiceMap.paymentRequestReceive-
 * Service) — the provider registry is not on the public Manager surface.
 * coco re-activates transports for every active operation on boot recovery,
 * so polling resumes automatically after restart.
 */

import { getPublicKey, nip19 } from 'nostr-tools';
import { PaymentRequestTransportType, type PaymentRequestTransport } from '@cashu/cashu-ts';
import type { Plugin } from '@cashu/coco-core/plugin';
import type { PaymentRequestReceiveOperation } from '@cashu/coco-core';

import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';
import { PAYMENT_RELAYS } from '@/shared/lib/nostr/sendDirectMessage';
import { cashuLog } from '@/shared/lib/logger';
import { reportCocoIssue } from '@/shared/lib/cashu/cocoFeedback';

/** Poll cadence while at least one payment-request op is active. Pull-based
 *  (nagg stores wraps), so payments received while offline are caught on the
 *  next tick — no live socket to babysit. */
const POLL_INTERVAL_MS = 15_000;
const POLL_LIMIT = 50;
const SEEN_CAP = 1000;
const GIFT_WRAP_KIND = 1059;

interface NostrTransportPluginConfig {
  /** Profile Nostr secret key (same key the P2PK import uses); captured per
   *  manager init so one profile's key never serves another's manager. */
  getSignerKey: () => Uint8Array | null;
}

/** Structural match for coco's PaymentRequestReceiveTransportHandler (the
 *  interface lives in an internal chunk; registerTransportHandler checks it
 *  structurally). */
interface NostrTransportHandler {
  readonly type: 'nostr';
  createRequestTransport(): PaymentRequestTransport;
  activate(operation: PaymentRequestReceiveOperation): void;
  deactivate(operation: PaymentRequestReceiveOperation): void;
}

function looksLikePaymentRequestPayload(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('{') && trimmed.includes('"proofs"') && trimmed.includes('"mint"');
}

export function createPaymentRequestNostrTransportPlugin(
  config: NostrTransportPluginConfig
): Plugin {
  return {
    name: 'sovran-payment-request-nostr-transport',
    required: ['paymentRequestReceiveService', 'logger'] as const,
    onInit(ctx) {
      const service = ctx.services.paymentRequestReceiveService;

      const activeOps = new Set<string>();
      const seenWraps = new Set<string>();
      let timer: ReturnType<typeof setInterval> | null = null;
      let polling = false;
      let disposed = false;
      let liveUnsub: (() => void) | null = null;
      let liveStarting = false;

      const capSeenWraps = (): void => {
        if (seenWraps.size <= SEEN_CAP) return;
        for (const id of [...seenWraps].slice(0, seenWraps.size - SEEN_CAP)) {
          seenWraps.delete(id);
        }
      };

      /**
       * Unwrap + ingest a single gift-wrap envelope. Shared by the poll and the
       * live subscription so dedupe (`seenWraps`), the unwrap cache, and coco's
       * `transportMessageId` idempotency are identical on both paths — a wrap
       * that arrives on both is ingested at most once. Re-reads the signer key
       * per call (the poll does too) so a profile switch never uses a stale key.
       */
      const handleEnvelope = async (
        envelope: { id: string; kind: number; content: string; pubkey: string },
        source: 'poll' | 'live'
      ): Promise<boolean> => {
        if (envelope.kind !== GIFT_WRAP_KIND || seenWraps.has(envelope.id)) return false;
        const secretKey = config.getSignerKey();
        if (!secretKey) return false;
        const viewerPubkey = getPublicKey(secretKey);
        seenWraps.add(envelope.id);
        capSeenWraps();
        const rumor = giftWrapCache.unwrap(
          viewerPubkey,
          { id: envelope.id, content: envelope.content, pubkey: envelope.pubkey },
          secretKey
        );
        if (!rumor || !looksLikePaymentRequestPayload(rumor.content)) return false;
        try {
          await service.ingestPayload(rumor.content, {
            transport: 'nostr',
            transportMessageId: envelope.id,
            senderPubkey: rumor.senderPubkey,
          });
          cashuLog.info('cashu.creq.transport.payload_ingested', {
            source,
            wrapIdLength: envelope.id.length,
            contentLength: rumor.content.length,
          });
          return true;
        } catch (error) {
          // Payloads for unknown/cancelled requests (or plain chat DMs that
          // happened to look like payloads) are expected — log and move on; the
          // wrap is marked seen so we never retry it.
          cashuLog.debug('cashu.creq.transport.payload_rejected', {
            source,
            error: error instanceof Error ? error.message : String(error),
          });
          return false;
        }
      };

      const pollOnce = async (): Promise<void> => {
        if (polling || disposed) return;
        const secretKey = config.getSignerKey();
        if (!secretKey) return;
        const viewerPubkey = getPublicKey(secretKey);
        // Lazy import: the data-layer chain pulls native-only modules
        // (ndk-mobile) that must not load at manager-module import time
        // (node-side tests import the manager).
        const { buildNostrDataLayer } = await import('@/shared/lib/nostr/buildNostrDataLayer');
        const layer = buildNostrDataLayer();
        if (!layer) {
          cashuLog.debug('cashu.creq.transport.poll_no_tiers');
          return;
        }
        polling = true;
        try {
          // The persistent unwrap cache is the cross-restart dedupe: the
          // in-memory seenWraps set dies with every manager re-init (profile
          // switch / reload), and re-unwrapping ~50 envelopes serially costs
          // ~8-10s of JS-thread NIP-44 crypto per re-init without it.
          await giftWrapCache.cache.hydrate(viewerPubkey);
          const outcome = await layer.getDmEnvelopes({
            viewerPubkey,
            limit: POLL_LIMIT,
            refresh: true,
          });
          const envelopes = outcome.match(
            (resolved) => resolved.envelopes,
            () => []
          );
          let ingested = 0;
          for (const envelope of envelopes) {
            if (disposed || activeOps.size === 0) break;
            if (await handleEnvelope(envelope, 'poll')) ingested += 1;
          }
          cashuLog.debug('cashu.creq.transport.poll_done', {
            envelopeCount: envelopes.length,
            ingested,
            activeOps: activeOps.size,
          });
        } catch (error) {
          cashuLog.warn('cashu.creq.transport.poll_failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          polling = false;
        }
      };

      const startPolling = () => {
        if (timer || disposed) return;
        timer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
        void pollOnce();
        cashuLog.info('cashu.creq.transport.polling_started', { activeOps: activeOps.size });
      };

      const stopPolling = () => {
        if (!timer) return;
        clearInterval(timer);
        timer = null;
        cashuLog.info('cashu.creq.transport.polling_stopped');
      };

      // Live push: a persistent relay REQ for the viewer's gift wraps, so a paid
      // request is claimed the instant the wrap arrives instead of on the next
      // 15s poll tick. The subscription has no auto-reconnect (relay socket drop
      // just stops feeding), so the poll above stays as the offline/reconnect
      // backstop — never remove it. Same unwrap→ingest path as the poll.
      const startLive = () => {
        if (liveUnsub || liveStarting || disposed) return;
        liveStarting = true;
        void (async () => {
          try {
            const secretKey = config.getSignerKey();
            if (!secretKey) return;
            const viewerPubkey = getPublicKey(secretKey);
            const { buildNostrDataLayer } = await import('@/shared/lib/nostr/buildNostrDataLayer');
            const layer = buildNostrDataLayer();
            // Deactivated / disposed / lost the key while the layer resolved.
            if (!layer || disposed || activeOps.size === 0) return;
            await giftWrapCache.cache.hydrate(viewerPubkey);
            if (disposed || activeOps.size === 0 || liveUnsub) return;
            liveUnsub = layer.subscribeDmEnvelopes({ viewerPubkey }, (env) => {
              void handleEnvelope(env, 'live');
            });
            cashuLog.info('cashu.creq.transport.live_started', { activeOps: activeOps.size });
          } catch (error) {
            cashuLog.warn('cashu.creq.transport.live_failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            liveStarting = false;
          }
        })();
      };

      const stopLive = () => {
        if (!liveUnsub) return;
        liveUnsub();
        liveUnsub = null;
        cashuLog.info('cashu.creq.transport.live_stopped');
      };

      const handler: NostrTransportHandler = {
        type: 'nostr',
        createRequestTransport() {
          const secretKey = config.getSignerKey();
          if (!secretKey) {
            // Upstream-relevant when it fires during create: the request was
            // asked for before the profile signer was available.
            reportCocoIssue('payment_request_transport_no_key', {});
            throw new Error('Nostr transport unavailable: no profile key');
          }
          const pubkey = getPublicKey(secretKey);
          const target = nip19.nprofileEncode({ pubkey, relays: PAYMENT_RELAYS.slice(0, 3) });
          // The signer key is the profile's Nostr identity (NostrKeysProvider
          // → setSignerKey), so this nprofile IS the profile npub. The npub
          // prefix is logged (public identity) so device logs can be checked
          // against the profile screen directly.
          cashuLog.info('cashu.creq.transport.identity', {
            npubPrefix: nip19.npubEncode(pubkey).slice(0, 12),
            relayCount: Math.min(PAYMENT_RELAYS.length, 3),
          });
          return {
            type: PaymentRequestTransportType.NOSTR,
            target,
            tags: [['n', '17']],
          };
        },
        activate(operation) {
          activeOps.add(operation.id);
          cashuLog.info('cashu.creq.transport.activated', {
            operationId: operation.id,
            activeOps: activeOps.size,
            singleUse: operation.singleUse,
          });
          startPolling();
          startLive();
        },
        deactivate(operation) {
          activeOps.delete(operation.id);
          cashuLog.info('cashu.creq.transport.deactivated', {
            operationId: operation.id,
            activeOps: activeOps.size,
          });
          if (activeOps.size === 0) {
            stopPolling();
            stopLive();
          }
        },
      };

      const unregister = service.registerTransportHandler(handler);
      cashuLog.info('cashu.creq.transport.registered');

      return () => {
        disposed = true;
        stopPolling();
        stopLive();
        activeOps.clear();
        unregister();
      };
    },
  };
}
