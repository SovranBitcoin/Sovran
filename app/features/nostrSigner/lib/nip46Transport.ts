/**
 * @fileoverview NIP-46 transport — dedicated relay pool + kind-24133 plumbing
 *
 * Owns an NDKPool fully separate from the app's main pool: client-specified
 * relays (e.g. wss://relay.nsec.app) must never pollute feed/DM subscriptions,
 * and the signer must tear down without touching app traffic. NDKPool's
 * constructor requires an NDK instance (verified against the installed
 * @nostr-dev-kit/ndk 2.11.0 d.ts), so the transport builds a minimal dedicated
 * NDK whose pool IS the "nip46" pool — the app's NDK is never reused. No
 * signer is ever assigned to that NDK instance (assigning one would set
 * activeUser and trigger autoConnectUserRelays); the injected signer is passed
 * explicitly everywhere it is needed.
 *
 * Pure transport over injected dependencies: no zustand store imports, no
 * react. The engine owns dedupe/TTL/permissions and per-peer encryption pins;
 * this module only moves and (de)envelopes bytes.
 *
 * NDK 2.11.0 facts this file relies on (all verified in dist/index.d.ts/.mjs):
 * - `pool.addRelay(relay, true)` registers the relay for auto-(re)connect and
 *   dials it immediately; connection failures are caught internally and feed
 *   the pool's reconnect/backoff machinery.
 * - A subscription created without an explicit relay set monitors its pool and
 *   re-issues its REQ on relays that (re)connect later — added relays join the
 *   live subscription automatically.
 * - NDKPool exposes no disconnect-all. `removeRelay(url)` disconnects the
 *   socket and clears the auto-connect registration, so stop() drains the pool
 *   relay by relay. (Relay-level event listeners registered by the pool are
 *   not unhooked by NDK; the relay objects are dropped with the pool.)
 * - `relay.publish(event, timeoutMs)` resolves only on the relay's OK frame
 *   (true accept), and rejects on error/timeout — racing per-relay publishes
 *   gives genuine resolve-on-first-accept semantics. NDKRelaySet.publish is
 *   NOT used: kind 24133 is in the ephemeral range, and the set publisher
 *   swallows all failures for ephemeral events.
 * - `relay.connect()` is a safe no-op unless the relay is DISCONNECTED or
 *   RECONNECTING, so reconnect() can sweep every relay unconditionally.
 *
 * The user's private key lives only inside the injected NDKPrivateKeySigner
 * held in class state — never in stores, logs, or persistence. Error paths
 * log through redactError; plaintext, ciphertext, and payloads are never
 * logged.
 */

import NDK, {
  NDKEvent,
  NDKPrivateKeySigner,
  NDKRelay,
  NDKRelayAuthPolicies,
  NDKSubscriptionCacheUsage,
  NDKUser,
  normalizeRelayUrl,
} from '@nostr-dev-kit/ndk-mobile';
import type { NDKAuthPolicy, NDKFilter, NDKKind, NDKSubscription } from '@nostr-dev-kit/ndk-mobile';
import { err, errAsync, ok, Result, ResultAsync } from 'neverthrow';

import { CREATED_AT_SKEW_SEC, NIP46_RPC_KIND } from '@/features/nostrSigner/lib/nip46Types';
import { nostrLog, redactError, type RedactedError } from '@/shared/lib/logger';

/** Per-relay publish timeout; sendResponse resolves on the FIRST relay OK. */
export const NIP46_PUBLISH_TIMEOUT_MS = 5_000;

/**
 * Envelope encryption scheme. Structurally identical to the connections
 * store's `ConnectionEncryption` per-peer pin — redeclared as a literal union
 * so this file stays free of store imports.
 */
export type Nip46Encryption = 'nip44' | 'nip04';

export type Nip46TransportError =
  | { type: 'not-started' }
  | { type: 'no-relays' }
  | { type: 'transport-failed'; cause: RedactedError }
  | { type: 'encrypt-failed'; cause: RedactedError }
  | { type: 'decrypt-failed'; cause: RedactedError }
  | { type: 'sign-failed'; cause: RedactedError }
  | { type: 'publish-failed'; cause: RedactedError };

const NOT_STARTED: Nip46TransportError = { type: 'not-started' };
const NO_RELAYS: Nip46TransportError = { type: 'no-relays' };

interface Nip46TransportStartParams {
  /**
   * The user's signing key. A raw Uint8Array is wrapped into an
   * NDKPrivateKeySigner; either way it lives only in transport state.
   */
  signer: NDKPrivateKeySigner | Uint8Array;
  /** Hex pubkey the subscription filters on (`#p`). */
  userPubkey: string;
  /** Relay-url union (defaults ∪ connection relays ∪ pending pairings). */
  relayUrls: readonly string[];
  /** Lower bound for the initial subscription window (epoch seconds). */
  sinceEpochSec: number;
  /** Raw kind-24133 events, exactly as received. The engine does the rest. */
  onEvent: (event: NDKEvent) => void;
}

interface Nip46SendResponseParams {
  toPubkey: string;
  /** Already-serialised RPC response JSON. Encrypted here, never logged. */
  payloadJson: string;
  encryption: Nip46Encryption;
}

interface Nip46DecryptedEnvelope {
  plaintext: string;
  /** Scheme that actually decrypted — the ENGINE decides whether to re-pin. */
  used: Nip46Encryption;
}

const safeNormalizeRelayUrl = Result.fromThrowable(
  (url: string) => normalizeRelayUrl(url),
  () => 'invalid-relay-url' as const
);

/**
 * Normalises + dedupes relay URLs, dropping unparseable entries. The raw URL
 * is never logged — client-supplied URIs can embed secrets.
 */
function normalizeRelayUrls(relayUrls: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const url of relayUrls) {
    const result = safeNormalizeRelayUrl(url);
    if (result.isOk()) {
      normalized.add(result.value);
    } else {
      nostrLog.warn('nostr.signer.transport_relay_url_invalid', { urlLength: url.length });
    }
  }
  return [...normalized];
}

function transportFailure(logEvent: string): (error: unknown) => Nip46TransportError {
  return (error) => {
    const cause = redactError(error);
    nostrLog.error(logEvent, { error: cause });
    return { type: 'transport-failed', cause };
  };
}

/**
 * Resolves as soon as ONE publish fulfils (relay OK frame); rejects with the
 * last error only after every relay has failed. Late settlements after the
 * first accept are swallowed — every promise gets a handler, so no unhandled
 * rejections.
 */
function firstRelayAccept(publishes: readonly Promise<boolean>[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let rejectedCount = 0;
    let lastError: unknown;
    let settled = false;
    for (const publish of publishes) {
      publish.then(
        () => {
          if (settled) return;
          settled = true;
          resolve();
        },
        (error: unknown) => {
          lastError = error;
          rejectedCount += 1;
          if (settled || rejectedCount < publishes.length) return;
          settled = true;
          reject(lastError instanceof Error ? lastError : new Error(String(lastError)));
        }
      );
    }
  });
}

export class Nip46Transport {
  private ndk: NDK | null = null;
  private signer: NDKPrivateKeySigner | null = null;
  private authPolicy: NDKAuthPolicy | null = null;
  private subscription: NDKSubscription | null = null;
  private onEvent: ((event: NDKEvent) => void) | null = null;
  private userPubkey: string | null = null;
  /**
   * Bumped on every subscription teardown; each event handler captures the
   * generation it was created under and drops events once it goes stale, so a
   * stopped subscription can never leak late events into the engine.
   */
  private generation = 0;
  private lastEventReceivedAtMs: number | null = null;

  get isStarted(): boolean {
    return this.ndk !== null;
  }

  /** Epoch ms of the last event delivered to onEvent; null before the first. */
  get lastEventReceivedAt(): number | null {
    return this.lastEventReceivedAtMs;
  }

  /**
   * Builds the dedicated NDK + "nip46" pool, dials the relay union, and
   * subscribes {kinds:[24133], #p:[userPubkey], since}. Idempotent: a second
   * call while running is an ok() no-op (relay changes go through rebuild).
   * Synchronous and react-free; sockets connect in the background under NDK's
   * own reconnect machinery.
   */
  start(params: Nip46TransportStartParams): Result<void, Nip46TransportError> {
    if (this.ndk) {
      nostrLog.debug('nostr.signer.transport_already_started');
      return ok(undefined);
    }
    const urls = normalizeRelayUrls(params.relayUrls);
    if (urls.length === 0) return err(NO_RELAYS);

    const assembled = Result.fromThrowable(() => {
      const signer =
        params.signer instanceof Uint8Array
          ? new NDKPrivateKeySigner(params.signer)
          : params.signer;
      // Minimal dedicated NDK: its pool is the "nip46" pool. No cache adapter,
      // no signer assignment (see file header), no explicit relays — every
      // relay is added below so it carries the NIP-42 auth policy.
      const ndk = new NDK({ explicitRelayUrls: [] });
      ndk.pool.name = 'nip46';
      // NIP-42-gated relays (e.g. nsec.app's): sign the AUTH challenge with
      // the injected signer. Set both per-relay (constructor arg below) and as
      // the pool-level default for completeness.
      const authPolicy = NDKRelayAuthPolicies.signIn({ ndk, signer });
      ndk.relayAuthDefaultPolicy = authPolicy;

      this.ndk = ndk;
      this.signer = signer;
      this.authPolicy = authPolicy;
      this.onEvent = params.onEvent;
      this.userPubkey = params.userPubkey;

      this.addRelays(urls);
      this.subscribeCurrent(params.sinceEpochSec);
      nostrLog.info('nostr.signer.transport_started', { relayCount: urls.length });
    }, transportFailure('nostr.signer.transport_start_failed'))();

    if (assembled.isErr()) this.teardownState();
    return assembled;
  }

  /**
   * Generation-based relay-set swap (pair/revoke): stops the old
   * subscription, adds/removes pool relays to match `relayUrls`, and
   * re-subscribes with an overlap-safe since (the engine's dedupe LRU absorbs
   * the redelivery window). Late events from the stopped generation are
   * dropped by the generation guard.
   */
  rebuild(relayUrls: readonly string[]): Result<void, Nip46TransportError> {
    const ndk = this.ndk;
    if (!ndk) return err(NOT_STARTED);
    const urls = normalizeRelayUrls(relayUrls);
    if (urls.length === 0) return err(NO_RELAYS);

    return Result.fromThrowable(() => {
      this.stopSubscription();
      const keep = new Set(urls);
      for (const url of [...ndk.pool.relays.keys()]) {
        if (!keep.has(url)) ndk.pool.removeRelay(url);
      }
      this.addRelays(urls);
      this.subscribeCurrent(this.overlapSafeSinceSec());
      nostrLog.info('nostr.signer.transport_rebuilt', { relayCount: urls.length });
    }, transportFailure('nostr.signer.transport_rebuild_failed'))();
  }

  /**
   * AppState-foreground path: redials any dropped sockets (no-op on live ones)
   * and restarts the subscription at its own overlap-safe since
   * (min(lastEventReceivedAt, now − 300s)) — the same window `rebuild` uses.
   */
  reconnect(): Result<void, Nip46TransportError> {
    const ndk = this.ndk;
    if (!ndk) return err(NOT_STARTED);

    return Result.fromThrowable(() => {
      this.stopSubscription();
      for (const relay of ndk.pool.relays.values()) {
        relay.connect().catch((error: unknown) => {
          nostrLog.warn('nostr.signer.transport_relay_reconnect_failed', {
            error: redactError(error),
          });
        });
      }
      this.subscribeCurrent(this.overlapSafeSinceSec());
      nostrLog.info('nostr.signer.transport_reconnected');
    }, transportFailure('nostr.signer.transport_reconnect_failed'))();
  }

  /**
   * Tears down the subscription and disconnects every pool socket. NDKPool
   * has no disconnect-all (verified, see file header): removeRelay() per url
   * both closes the socket and clears its auto-reconnect registration. Drops
   * the signer reference. Idempotent.
   */
  stop(): Result<void, Nip46TransportError> {
    const ndk = this.ndk;
    if (!ndk) return ok(undefined);

    const result = Result.fromThrowable(() => {
      this.stopSubscription();
      for (const url of [...ndk.pool.relays.keys()]) {
        ndk.pool.removeRelay(url);
      }
      nostrLog.info('nostr.signer.transport_stopped');
    }, transportFailure('nostr.signer.transport_stop_failed'))();

    this.teardownState();
    return result;
  }

  /**
   * Decrypts an inbound envelope, trying the per-peer pinned scheme first and
   * falling back to the other. Reports which scheme worked — the ENGINE
   * decides whether to update the pin. Plaintext is never logged.
   */
  decryptEnvelope(
    senderPubkey: string,
    content: string,
    pinned: Nip46Encryption
  ): ResultAsync<Nip46DecryptedEnvelope, Nip46TransportError> {
    const signer = this.signer;
    if (!signer) return errAsync(NOT_STARTED);

    const sender = new NDKUser({ pubkey: senderPubkey });
    const attempt = (scheme: Nip46Encryption): ResultAsync<string, unknown> =>
      ResultAsync.fromPromise(
        scheme === 'nip44'
          ? signer.nip44Decrypt(sender, content)
          : signer.nip04Decrypt(sender, content),
        (error) => error
      );

    const fallback: Nip46Encryption = pinned === 'nip44' ? 'nip04' : 'nip44';
    return attempt(pinned)
      .map((plaintext) => ({ plaintext, used: pinned }))
      .orElse(() => attempt(fallback).map((plaintext) => ({ plaintext, used: fallback })))
      .mapErr((error) => {
        const cause = redactError(error);
        nostrLog.warn('nostr.signer.transport_decrypt_failed', { error: cause });
        return { type: 'decrypt-failed', cause } as const;
      });
  }

  /**
   * Encrypts `payloadJson` to `toPubkey` with the requested scheme, builds a
   * signed kind-24133 event tagged ['p', toPubkey], and publishes it to the
   * dedicated pool. Resolves on the FIRST relay OK; errs only when every
   * relay fails or times out (NIP46_PUBLISH_TIMEOUT_MS each, racing concurrently).
   */
  sendResponse(params: Nip46SendResponseParams): ResultAsync<void, Nip46TransportError> {
    const ndk = this.ndk;
    const signer = this.signer;
    if (!ndk || !signer) return errAsync(NOT_STARTED);
    const relays = [...ndk.pool.relays.values()];
    if (relays.length === 0) return errAsync(NO_RELAYS);

    const recipient = new NDKUser({ pubkey: params.toPubkey });
    return ResultAsync.fromPromise(
      params.encryption === 'nip44'
        ? signer.nip44Encrypt(recipient, params.payloadJson)
        : signer.nip04Encrypt(recipient, params.payloadJson),
      (error): Nip46TransportError => {
        const cause = redactError(error);
        nostrLog.error('nostr.signer.transport_encrypt_failed', { error: cause });
        return { type: 'encrypt-failed', cause };
      }
    )
      .andThen((ciphertext) => {
        const event = new NDKEvent(ndk);
        event.kind = NIP46_RPC_KIND;
        event.content = ciphertext;
        event.tags = [['p', params.toPubkey]];
        event.created_at = Math.floor(Date.now() / 1000);
        return ResultAsync.fromPromise(event.sign(signer), (error): Nip46TransportError => {
          const cause = redactError(error);
          nostrLog.error('nostr.signer.transport_sign_failed', { error: cause });
          return { type: 'sign-failed', cause };
        }).map(() => event);
      })
      .andThen((event) =>
        ResultAsync.fromPromise(
          firstRelayAccept(relays.map((relay) => relay.publish(event, NIP46_PUBLISH_TIMEOUT_MS))),
          (error): Nip46TransportError => {
            const cause = redactError(error);
            nostrLog.error('nostr.signer.transport_publish_failed', {
              error: cause,
              relayCount: relays.length,
            });
            return { type: 'publish-failed', cause };
          }
        )
      )
      .map(() => undefined);
  }

  // ── Internals ───────────────────────────────────────────────────

  /** Adds any missing relays (normalized urls) with the NIP-42 auth policy. */
  private addRelays(urls: readonly string[]): void {
    const ndk = this.ndk;
    if (!ndk) return;
    for (const url of urls) {
      if (ndk.pool.relays.has(url)) continue;
      const relay = new NDKRelay(url, this.authPolicy ?? undefined, ndk);
      ndk.pool.addRelay(relay, true);
    }
  }

  private subscribeCurrent(sinceEpochSec: number): void {
    const ndk = this.ndk;
    const onEvent = this.onEvent;
    const userPubkey = this.userPubkey;
    if (!ndk || !onEvent || !userPubkey) return;

    const generation = this.generation;
    const filter: NDKFilter = {
      kinds: [NIP46_RPC_KIND as NDKKind],
      '#p': [userPubkey],
      since: sinceEpochSec,
    };
    // No explicit relay set: the subscription targets the dedicated ndk's
    // pool (= the nip46 pool) and its pool monitor re-REQs on relays that
    // (re)connect or are added later.
    const subscription = ndk.subscribe(filter, {
      closeOnEose: false,
      groupable: false,
      cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
      subId: `nip46-${generation}`,
    });
    subscription.on('event', (event: NDKEvent) => {
      if (generation !== this.generation) return; // late event from a stopped generation
      this.lastEventReceivedAtMs = Date.now();
      onEvent(event);
    });
    this.subscription = subscription;
  }

  private stopSubscription(): void {
    this.generation += 1;
    if (!this.subscription) return;
    this.subscription.stop();
    this.subscription = null;
  }

  /**
   * Resubscribe lower bound: never later than now − CREATED_AT_SKEW_SEC, and
   * never later than the last delivered event. The engine's dedupe LRU (which
   * spans generations) absorbs the deliberate overlap.
   */
  private overlapSafeSinceSec(): number {
    const skewedNowSec = Math.floor(Date.now() / 1000) - CREATED_AT_SKEW_SEC;
    if (this.lastEventReceivedAtMs === null) return skewedNowSec;
    return Math.min(skewedNowSec, Math.floor(this.lastEventReceivedAtMs / 1000));
  }

  private teardownState(): void {
    this.subscription = null;
    this.ndk = null;
    this.signer = null; // release the key-holding signer reference
    this.authPolicy = null;
    this.onEvent = null;
    this.userPubkey = null;
  }
}
