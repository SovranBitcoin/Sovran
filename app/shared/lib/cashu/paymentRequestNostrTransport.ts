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
 *   2. while any request operation is ACTIVE, polls the viewer's gift-wrap
 *      inbox (nagg DM index → relay floor via the shared nostr data layer —
 *      the same pull-based architecture as the payments DM screens), unwraps
 *      each kind-1059 envelope, and feeds NUT-18-looking rumor contents into
 *      `paymentRequestReceiveService.ingestPayload` with the wrap event id
 *      as `transportMessageId` (coco's idempotency key) and the rumor author
 *      as `senderPubkey`.
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

import { unwrapGiftWrap } from '@/shared/lib/nostr/nip17';
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
            if (envelope.kind !== GIFT_WRAP_KIND || seenWraps.has(envelope.id)) continue;
            seenWraps.add(envelope.id);
            const rumor = unwrapGiftWrap(
              { content: envelope.content, pubkey: envelope.pubkey },
              secretKey
            );
            if (!rumor || !looksLikePaymentRequestPayload(rumor.content)) continue;
            try {
              await service.ingestPayload(rumor.content, {
                transport: 'nostr',
                transportMessageId: envelope.id,
                senderPubkey: rumor.senderPubkey,
              });
              ingested += 1;
              cashuLog.info('cashu.creq.transport.payload_ingested', {
                wrapIdLength: envelope.id.length,
                contentLength: rumor.content.length,
              });
            } catch (error) {
              // Payloads for unknown/cancelled requests (or plain chat DMs
              // that happened to look like payloads) are expected — log and
              // move on; the wrap is marked seen so we never retry it.
              cashuLog.debug('cashu.creq.transport.payload_rejected', {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          if (seenWraps.size > SEEN_CAP) {
            for (const id of [...seenWraps].slice(0, seenWraps.size - SEEN_CAP)) {
              seenWraps.delete(id);
            }
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
        },
        deactivate(operation) {
          activeOps.delete(operation.id);
          cashuLog.info('cashu.creq.transport.deactivated', {
            operationId: operation.id,
            activeOps: activeOps.size,
          });
          if (activeOps.size === 0) stopPolling();
        },
      };

      const unregister = service.registerTransportHandler(handler);
      cashuLog.info('cashu.creq.transport.registered');

      return () => {
        disposed = true;
        stopPolling();
        activeOps.clear();
        unregister();
      };
    },
  };
}
