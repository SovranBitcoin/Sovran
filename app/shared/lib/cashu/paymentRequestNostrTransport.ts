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
 *      (nagg DM index → relay floor) as the offline/reconnect backstop. The
 *      poll stops while the app is backgrounded and runs once immediately on
 *      return to the foreground. Each
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

import { AppState, type AppStateStatus } from 'react-native';
import { getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import { PaymentRequestTransportType, type PaymentRequestTransport } from '@cashu/cashu-ts';
import type { Plugin } from '@cashu/coco-core/plugin';
import type { PaymentRequestReceiveOperation } from '@cashu/coco-core';

import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';
import { PAYMENT_RELAYS } from '@/shared/lib/nostr/sendDirectMessage';
import { cashuLog, monotonicNow } from '@/shared/lib/logger';
import { newReadId, readErrorType, readEvents, readKeyHash } from '@/shared/lib/read/readLog';
import { reportCocoIssue } from '@/shared/lib/cashu/cocoFeedback';

/** Poll cadence while at least one payment-request op is active. Pull-based
 *  (nagg stores wraps), so payments received while offline are caught on the
 *  next tick — no live socket to babysit. */
const POLL_INTERVAL_MS = 15_000;
/** Ceiling for one tier's answer. The facade tries its tiers in sequence and
 *  applies this to each, so a hung nagg hands over to the relay floor inside
 *  the same tick instead of holding the default 30s across two of them. */
const POLL_TIER_TIMEOUT_MS = 6_000;
/** Ceiling for the whole read, below the cadence whatever the tier count, so a
 *  slow tick has always settled before the next one is due. */
const POLL_DEADLINE_MS = 13_000;
const POLL_LIMIT = 50;
const GIFT_WRAP_OVERLAP_SEC = 2 * 24 * 60 * 60;
const GIFT_WRAP_KIND = 1059;

type InboxLayer = Pick<
  NonNullable<
    ReturnType<(typeof import('@/shared/lib/nostr/buildNostrDataLayer'))['buildNostrDataLayer']>
  >,
  'getDmEnvelopes' | 'subscribeDmEnvelopes'
>;
interface NostrTransportPluginConfig {
  loadDataLayer?: () => Promise<InboxLayer | null>;
  /** Profile Nostr secret key (same key the P2PK import uses); captured per
   *  manager init so one profile's key never serves another's manager. */
  getSignerKey: () => Uint8Array | null;
  /** Foreground signal; injected by tests. */
  appState?: {
    currentState: AppStateStatus;
    addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove(): void };
  };
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

/**
 * NUT-18 makes `unit` default to sat, but coco rejects a payload without one.
 * Fill it in rather than drop a payer's ecash; otherwise pass the raw string
 * through untouched so coco's integer-safe parse and payload hash still apply.
 */
export function withDefaultUnit(content: string): string {
  try {
    const raw: unknown = JSON.parse(content);
    if (raw && typeof raw === 'object' && !('unit' in raw && (raw as { unit?: unknown }).unit)) {
      return JSON.stringify({ ...raw, unit: 'sat' });
    }
  } catch {
    // Not JSON: coco reports it.
  }
  return content;
}

export function createPaymentRequestNostrTransportPlugin(
  config: NostrTransportPluginConfig
): Plugin {
  return {
    name: 'sovran-payment-request-nostr-transport',
    required: ['paymentRequestReceiveService', 'logger'] as const,
    onInit(ctx) {
      const service = ctx.services.paymentRequestReceiveService;
      const loadDataLayer =
        config.loadDataLayer ??
        (async () => {
          const { buildNostrDataLayer } = await import('@/shared/lib/nostr/buildNostrDataLayer');
          return buildNostrDataLayer();
        });

      const activeOps = new Set<string>();
      // Terminal wraps stay deduplicated for the whole manager/profile session.
      let inboxSession: {
        viewerPubkey: string;
        newestCreatedAtSec: number | undefined;
        seenWraps: Set<string>;
        inFlightWraps: Set<string>;
      } = {
        viewerPubkey: '',
        newestCreatedAtSec: undefined,
        seenWraps: new Set<string>(),
        inFlightWraps: new Set<string>(),
      };
      const sessionFor = (viewerPubkey: string) => {
        if (inboxSession.viewerPubkey !== viewerPubkey) {
          inboxSession = {
            viewerPubkey,
            newestCreatedAtSec: undefined,
            seenWraps: new Set<string>(),
            inFlightWraps: new Set<string>(),
          };
        }
        return inboxSession;
      };
      const appState = config.appState ?? AppState;
      let timer: ReturnType<typeof setInterval> | null = null;
      let polling = false;
      /** A poll was asked for while one was in flight; run it when that settles. */
      let pollQueued = false;
      let backgrounded = appState.currentState === 'background';
      let recoveryNeeded = false;
      let recovering = false;
      let disposed = false;
      let liveUnsub: (() => void) | null = null;
      let liveStarting = false;
      /** Monotonic per-tick counter, so a `reads` report can order the poll's ticks. */
      let pollGeneration = 0;

      /**
       * Unwrap + ingest a single gift-wrap envelope. Shared by the poll and the
       * live subscription so dedupe (`seenWraps`), the unwrap cache, and coco's
       * `transportMessageId` idempotency are identical on both paths — a wrap
       * that arrives on both is ingested at most once. Re-reads the signer key
       * per call (the poll does too) so a profile switch never uses a stale key.
       */
      const handleEnvelope = async (
        envelope: { id: string; kind: number; content: string; pubkey: string },
        source: 'poll' | 'live',
        expectedViewerPubkey: string
      ): Promise<boolean> => {
        if (disposed || activeOps.size === 0 || envelope.kind !== GIFT_WRAP_KIND) return false;
        const secretKey = config.getSignerKey();
        if (!secretKey) return false;
        const viewerPubkey = getPublicKey(secretKey);
        if (viewerPubkey !== expectedViewerPubkey) return false;
        const { seenWraps, inFlightWraps } = sessionFor(viewerPubkey);
        if (seenWraps.has(envelope.id) || inFlightWraps.has(envelope.id)) return false;
        inFlightWraps.add(envelope.id);
        try {
          const rumor = giftWrapCache.unwrap(
            viewerPubkey,
            { id: envelope.id, content: envelope.content, pubkey: envelope.pubkey },
            secretKey
          );
          if (!rumor || !looksLikePaymentRequestPayload(rumor.content)) {
            inFlightWraps.delete(envelope.id);
            seenWraps.add(envelope.id);
            return false;
          }
          if (disposed) return false;
          const result = await service.ingestPayload(withDefaultUnit(rumor.content), {
            transport: 'nostr',
            transportMessageId: envelope.id,
            senderPubkey: rumor.senderPubkey,
          });
          if (result.attempt.state !== 'finalized' && result.attempt.state !== 'rejected') {
            recoveryNeeded = true;
            return false;
          }
          seenWraps.add(envelope.id);
          cashuLog.info('cashu.creq.transport.payload_ingested', {
            source,
            wrapIdLength: envelope.id.length,
            contentLength: rumor.content.length,
          });
          return result.attempt.state === 'finalized';
        } catch (error) {
          recoveryNeeded = true;
          // A concurrent BLE claim or transient mint failure must remain
          // retryable. Only Coco terminal attempts enter the seen set.
          cashuLog.debug('cashu.creq.transport.payload_rejected', {
            source,
            error: error instanceof Error ? error.message : String(error),
          });
          return false;
        } finally {
          inFlightWraps.delete(envelope.id);
        }
      };

      const pollInbox = async (): Promise<void> => {
        if (disposed) return;
        const secretKey = config.getSignerKey();
        if (!secretKey) return;
        const viewerPubkey = getPublicKey(secretKey);
        const session = sessionFor(viewerPubkey);
        // Lazy import: the data-layer chain pulls native-only modules
        // (ndk-mobile) that must not load at manager-module import time
        // (node-side tests import the manager).
        const layer = await loadDataLayer();
        if (!layer) {
          cashuLog.debug('cashu.creq.transport.poll_no_tiers');
          return;
        }
        // This poll reads the viewer's whole gift-wrap inbox on a timer. It
        // carries the standard read lifecycle under its OWN surface so
        // log-doctor's `reads` mode can price it: without these, the poll shows
        // up only as `nostr.read.dmEnvelopes.*` from the facade, which reads as
        // "the DM list fetched" and is invisible in the per-surface report.
        // `trigger: 'poll'` + `mode: 'refresh'` is what makes a tick that
        // ingests nothing recognisable as wasted work.
        const readId = newReadId('paymentRequestInbox');
        const keyHash = readKeyHash(viewerPubkey);
        const t0 = monotonicNow();
        readEvents.request({
          readId,
          surface: 'paymentRequestInbox',
          keyHash,
          mode: 'refresh',
          trigger: 'poll',
          // `refresh: true` below bypasses whatever the facade holds, so this is
          // always a fetch — never a cache serve, however fresh the last tick was.
          action: 'fetch',
          strategy: 'sequential',
          cached: false,
          stale: false,
          coldStart: false,
          gen: pollGeneration,
        });
        pollGeneration += 1;
        try {
          // The persistent unwrap cache is the cross-restart dedupe: the
          // in-memory seenWraps set dies with every manager re-init (profile
          // switch / reload), and re-unwrapping ~50 envelopes serially costs
          // ~8-10s of JS-thread NIP-44 crypto per re-init without it.
          await giftWrapCache.cache.hydrate(viewerPubkey);
          const deadline = new AbortController();
          const deadlineTimer = setTimeout(() => deadline.abort(), POLL_DEADLINE_MS);
          const outcome = await layer
            .getDmEnvelopes({
              viewerPubkey,
              limit: POLL_LIMIT,
              ...(session.newestCreatedAtSec !== undefined
                ? { since: session.newestCreatedAtSec - GIFT_WRAP_OVERLAP_SEC }
                : {}),
              refresh: true,
              timeoutMs: POLL_TIER_TIMEOUT_MS,
              signal: deadline.signal,
            })
            .finally(() => clearTimeout(deadlineTimer));
          const envelopes = outcome.match(
            (resolved) => resolved.envelopes,
            () => []
          );
          const currentKey = config.getSignerKey();
          if (disposed || !currentKey || getPublicKey(currentKey) !== viewerPubkey) return;
          let ingested = 0;
          for (const envelope of envelopes) {
            if (disposed || activeOps.size === 0 || inboxSession !== session) break;
            // Never advance from the clock: late wraps may be two days older.
            session.newestCreatedAtSec = Math.max(
              session.newestCreatedAtSec ?? envelope.createdAtSec,
              envelope.createdAtSec
            );
            if (session.seenWraps.has(envelope.id) || session.inFlightWraps.has(envelope.id))
              continue;
            if (await handleEnvelope(envelope, 'poll', viewerPubkey)) ingested += 1;
          }
          cashuLog.debug('cashu.creq.transport.poll_done', {
            envelopeCount: envelopes.length,
            ingested,
            activeOps: activeOps.size,
          });
          readEvents.done({
            readId,
            surface: 'paymentRequestInbox',
            keyHash,
            gen: pollGeneration,
            durationMs: Math.round(monotonicNow() - t0),
            source: 'network',
            // `count` is what this tick actually DELIVERED to coco, not what the
            // relay returned: a tick that re-reads 133 wraps and ingests none is
            // an `empty` read that cost a full round-trip, and that is the
            // number the `reads` report should show.
            count: ingested,
            empty: ingested === 0,
            // The transport asks for `POLL_LIMIT` but the relay tier ignores
            // `limit` by design (randomized gift-wrap `created_at`), so record
            // the gap between what was requested and what arrived.
            degraded: envelopes.length > POLL_LIMIT,
            complete: true,
          });
        } catch (error) {
          cashuLog.warn('cashu.creq.transport.poll_failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          readEvents.failed({
            readId,
            surface: 'paymentRequestInbox',
            keyHash,
            gen: pollGeneration,
            durationMs: Math.round(monotonicNow() - t0),
            errorType: readErrorType(error),
            // Nothing is on screen for this read; a failed tick simply means the
            // next one is the backstop.
            retained: false,
          });
        }
      };

      const pollOnce = async () => {
        if (polling || disposed) return;
        polling = true;
        // Re-ingestion alone returns a stored receiving attempt. Ask Coco to
        // reconcile its child operation, without blocking inbox discovery on a
        // stalled mint. Its operation locks serialize this with live claims.
        if (recoveryNeeded && !recovering) {
          recovering = true;
          recoveryNeeded = false;
          void service
            .recoverPendingAttempts()
            .catch(() => {
              recoveryNeeded = true;
            })
            .finally(() => {
              recovering = false;
            });
        }
        try {
          await pollInbox();
        } catch (error) {
          cashuLog.debug('cashu.creq.transport.poll_unavailable', {
            error: error instanceof Error ? error.name : 'unknown',
          });
        } finally {
          polling = false;
          if (pollQueued) {
            pollQueued = false;
            if (timer) void pollOnce();
          }
        }
      };

      /** The immediate poll on start. One already in flight began before this
       *  was asked for (before the app came back, say), so it cannot stand in
       *  for it: queue a fresh one behind it rather than drop the request. */
      const pollNow = () => {
        if (polling) pollQueued = true;
        else void pollOnce();
      };

      const startPolling = () => {
        if (timer || disposed || backgrounded) return;
        timer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
        pollNow();
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
            const layer = await loadDataLayer();
            // Deactivated / disposed / lost the key while the layer resolved.
            if (!layer || disposed || activeOps.size === 0) return;
            await giftWrapCache.cache.hydrate(viewerPubkey);
            if (disposed || activeOps.size === 0 || liveUnsub) return;
            liveUnsub = layer.subscribeDmEnvelopes({ viewerPubkey }, (env) => {
              const currentKey = config.getSignerKey();
              if (!currentKey || getPublicKey(currentKey) !== viewerPubkey) return;
              void handleEnvelope(env, 'live', viewerPubkey);
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

      // Nothing can be claimed while the app is backgrounded that the first
      // poll back in the foreground does not find, so the timer only runs in
      // the foreground. `inactive` (iOS app switcher, a system sheet) keeps
      // polling: the app is still on screen. The live subscription is left
      // alone; the relay socket's fate in the background is the OS's.
      const appStateSubscription = appState.addEventListener('change', (state) => {
        if (state === 'background') {
          backgrounded = true;
          stopPolling();
        } else if (state === 'active' && backgrounded) {
          backgrounded = false;
          if (activeOps.size > 0) startPolling();
        }
      });

      const unregister = service.registerTransportHandler(handler);
      cashuLog.info('cashu.creq.transport.registered');

      return () => {
        disposed = true;
        // Jest's react-native mock hands back no subscription.
        appStateSubscription?.remove();
        stopPolling();
        stopLive();
        activeOps.clear();
        unregister();
      };
    },
  };
}
