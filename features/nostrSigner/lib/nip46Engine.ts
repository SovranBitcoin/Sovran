/**
 * @fileoverview NIP-46 engine — request pipeline, handshakes, verdict plumbing
 *
 * React-free module singleton between the transport (raw kind-24133 events)
 * and the stores/UI. Stores are reached via `useX.getState()` so the engine
 * also runs headless (phase-2 push path).
 *
 * Inbound pipeline (each gate drops silently unless noted):
 *   dedupe LRU (envelope id, then rpc id after decrypt; spans rebuilds)
 *   → created_at skew (±CREATED_AT_SKEW_SEC)
 *   → sender lookup → stranger with no outstanding bunker secret and no
 *     awaited nostrconnect pairing? drop (DoS guard — never leak liveness)
 *   → SIGNATURE VERIFY — a cheap schnorr pre-filter, after the connection/
 *     secret gates so unsolicited traffic dies on map lookups first.
 *     NDKEvent.verifySignature(true) is synchronous on the dedicated transport
 *     NDK; it is NOT trusted as the anti-spoofing gate, because NDK caches
 *     verify verdicts process-globally by event id, so a forged envelope can
 *     replay a recently-cached id and pass.
 *   → decrypt (per-peer pin, fallback; re-pin on mismatch)
 *   → rateLimiter.take — AFTER decrypt, deliberately: the ECDH decrypt is the
 *     real sender authentication, so a forged envelope spoofing a paired app's
 *     pubkey (it cannot be decrypted) never consumes that app's rate budget
 *     (spoofed-sender rate-limit DoS guard).
 *   → RpcRequest zod parse → connect handshake | permissionPolicy.evaluate
 *   → allow: execute + respond + log · deny: respond error + log · ask:
 *     enqueue (TTL) + resolver context in module scope + verdict callbacks.
 *
 * Responses are only ever sent to ACTIVE paired apps, mid-pairing clients, or
 * a stranger presenting a bunker secret while one is outstanding. Blocked or
 * disconnected apps get no response anywhere — the inbound, resolve-time, and
 * expiry-time paths each re-check the connection — with one deliberate
 * exception: the request the user was reading when they pressed Block gets
 * its final "Not authorized" (the app was paired when it asked).
 *
 * The private key lives only in the held NDKPrivateKeySigner (module state);
 * stop() drops the reference. Nothing secret-bearing is logged — redactError
 * everywhere, no params/plaintexts/URIs in log payloads.
 */

import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk-mobile';
import type { NDKEvent } from '@nostr-dev-kit/ndk-mobile';
import { err, errAsync, ok, Result, ResultAsync } from 'neverthrow';

import {
  useNip46ActivityStore,
  type Nip46ActivitySummaryV2,
} from '@/features/nostrSigner/data/nip46ActivityStore';
import {
  useNip46ConnectionsStore,
  type Nip46Connection,
  type AdoptConnectionError,
  type UpsertAppError,
} from '@/features/nostrSigner/data/nip46ConnectionsStore';
import {
  useNip46RequestsStore,
  type Nip46ParamsPreview,
  type Nip46PendingRequest,
} from '@/features/nostrSigner/data/nip46RequestsStore';
import {
  consumeSecret as consumeBunkerSecret,
  hasOutstanding as hasOutstandingBunkerSecret,
  type BunkerSecretsError,
} from '@/features/nostrSigner/lib/bunkerSecrets';
import { safeJsonParse } from '@/features/nostrSigner/lib/json';
import {
  extractSignedEventId,
  isExecutableMethod,
  methodHandlers,
} from '@/features/nostrSigner/lib/methodHandlers';
import {
  Nip46Transport,
  type Nip46Encryption,
  type Nip46TransportError,
} from '@/features/nostrSigner/lib/nip46Transport';
import {
  CREATED_AT_SKEW_SEC,
  NIP46_ERRORS,
  REQUEST_TTL_MS,
  RpcRequestSchema,
  SUMMARY_MAX_LENGTH,
  UnsignedEventSchema,
  type ActivityVerdict,
  type GrantKey,
  type Nip46Method,
  type RpcRequest,
  type RpcResponse,
  type UnsignedEvent,
} from '@/features/nostrSigner/lib/nip46Types';
import type { ParsedNostrConnectUri } from '@/features/nostrSigner/lib/nip46Uri';
import {
  DENY_ERROR_BY_REASON,
  evaluate,
  type PolicyDecision,
} from '@/features/nostrSigner/lib/permissionPolicy';
import { createRateLimiter, type Nip46RateLimiter } from '@/features/nostrSigner/lib/rateLimiter';
import { findPreviousConnection } from '@/features/nostrSigner/lib/connectionMatch';
import { summarizeRequest } from '@/features/nostrSigner/lib/requestSummary';
import {
  resolveVerdict,
  type Nip46RequestDecision,
  type PendingRequestContext,
  type VerdictResolverSeam,
} from '@/features/nostrSigner/lib/verdictResolver';
import { nostrLog, redactError } from '@/shared/lib/logger';
import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';
import { relays as defaultSignerRelays } from '@/shared/ndk';

const DEDUPE_LRU_SIZE = 512;
export const EXPIRY_SWEEP_INTERVAL_MS = 10_000;

// ── Public types ────────────────────────────────────────────────

export type Nip46EngineError =
  | { type: 'not-started' }
  | { type: 'transport'; cause: Nip46TransportError }
  | { type: 'unknown-request' }
  | { type: 'upsert-failed'; cause: UpsertAppError }
  | { type: 'adopt-failed'; cause: AdoptConnectionError | 'inherit_mismatch' };

export interface Nip46EngineStartConfig {
  /** Raw bytes are wrapped into an NDKPrivateKeySigner; held only in module state. */
  signer: NDKPrivateKeySigner | Uint8Array;
  /** Hex pubkey of the active profile (= remote-signer pubkey, Amber model). */
  userPubkey: string;
}

export interface CompleteNostrconnectPairingInput {
  parsed: ParsedNostrConnectUri;
  /** Perm toggles the user accepted — persisted as always-grants (origin 'pairing'). */
  acceptedGrantKeys: readonly GrantKey[];
  /**
   * Every eligible (toggleable) grant key the review sheet presented. On a
   * re-pair, presented keys the user left UNCHECKED have their standing
   * 'always' grant cleared back to ask — so the "Update Permissions" downgrade
   * the sheet promised actually takes effect. Omitted ⇒ no reconcile (the
   * additive merge stands). 'deny' grants are never touched (the sheet has no
   * deny affordance; that lives in the per-app editor).
   */
  presentedGrantKeys?: readonly GrantKey[];
  /**
   * Client pubkey of the prior connection this pairing REPLACES (the
   * Reconnect / blocked-fresh sheet variants). The engine re-derives the
   * identity match itself and fails the pairing on any disagreement — this
   * field can never transfer grants to a record the matcher would not pick.
   * The engine decides inherit-vs-fresh from the matched record's status.
   */
  replacesClientPubkey?: string;
}

/** Structural subset of Nip46Transport the engine drives — injectable in tests. */
export interface Nip46EngineTransport {
  readonly isStarted: boolean;
  start(params: {
    signer: NDKPrivateKeySigner | Uint8Array;
    userPubkey: string;
    relayUrls: readonly string[];
    sinceEpochSec: number;
    onEvent: (event: NDKEvent) => void;
  }): Result<void, Nip46TransportError>;
  rebuild(relayUrls: readonly string[]): Result<void, Nip46TransportError>;
  /** Redial + re-subscribe at the transport's own overlap-safe since. */
  reconnect(): Result<void, Nip46TransportError>;
  stop(): Result<void, Nip46TransportError>;
  decryptEnvelope(
    senderPubkey: string,
    content: string,
    pinned: Nip46Encryption
  ): ResultAsync<{ plaintext: string; used: Nip46Encryption }, Nip46TransportError>;
  sendResponse(params: {
    toPubkey: string;
    payloadJson: string;
    encryption: Nip46Encryption;
  }): ResultAsync<void, Nip46TransportError>;
}

export interface Nip46EngineDeps {
  transport: Nip46EngineTransport;
  rateLimiter: Nip46RateLimiter;
  consumeSecret: (activePubkey: string, secret: string) => ResultAsync<boolean, BunkerSecretsError>;
  hasOutstandingSecret: (activePubkey: string) => ResultAsync<boolean, BunkerSecretsError>;
  defaultRelays: readonly string[];
  now: () => number;
  /** Ids for engine-initiated responses (nostrconnect secret echo). */
  mintRpcId: () => string;
}

export type OnUserVerdictNeeded = (request: Nip46PendingRequest) => void;

// ── Internals ───────────────────────────────────────────────────

const NOT_STARTED: Nip46EngineError = { type: 'not-started' };

/** Insertion-ordered LRU membership set (Map keeps recency via delete+set). */
class LruSet {
  private readonly entries = new Map<string, true>();
  constructor(private readonly capacity: number) {}

  has(key: string): boolean {
    return this.entries.has(key);
  }

  add(key: string): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, true);
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }
}

interface EngineState {
  userPubkey: string;
  signer: NDKPrivateKeySigner;
}

interface ParsedSignParams {
  unsigned: UnsignedEvent | null;
  kind: number | undefined;
  preview: Nip46ParamsPreview;
}

export interface Nip46Engine {
  readonly isStarted: boolean;
  start(config: Nip46EngineStartConfig): Result<void, Nip46EngineError>;
  stop(): Result<void, Nip46EngineError>;
  rebuildRelays(): Result<void, Nip46EngineError>;
  /** AppState-foreground: redial + re-subscribe at min(lastEvent, now−skew). */
  reconnect(): Result<void, Nip46EngineError>;
  startNostrconnectPairing(parsed: ParsedNostrConnectUri): Result<void, Nip46EngineError>;
  completeNostrconnectPairing(
    input: CompleteNostrconnectPairingInput
  ): ResultAsync<void, Nip46EngineError>;
  cancelNostrconnectPairing(clientPubkey: string): Result<void, Nip46EngineError>;
  resolveRequest(
    requestId: string,
    decision: Nip46RequestDecision
  ): ResultAsync<void, Nip46EngineError>;
  /** UI hook for "a prompt is needed"; returns unsubscribe. Default: no listeners. */
  onUserVerdictNeeded(callback: OnUserVerdictNeeded): () => void;
}

export function createNip46Engine(overrides: Partial<Nip46EngineDeps> = {}): Nip46Engine {
  const deps: Nip46EngineDeps = {
    transport: overrides.transport ?? new Nip46Transport(),
    rateLimiter: overrides.rateLimiter ?? createRateLimiter(),
    consumeSecret: overrides.consumeSecret ?? consumeBunkerSecret,
    hasOutstandingSecret: overrides.hasOutstandingSecret ?? hasOutstandingBunkerSecret,
    defaultRelays: overrides.defaultRelays ?? defaultSignerRelays,
    now: overrides.now ?? Date.now,
    mintRpcId: overrides.mintRpcId ?? (() => Math.floor(Math.random() * 0xffffffff).toString(16)),
  };

  let state: EngineState | null = null;
  /**
   * Bumped on every start AND stop (mirrors the transport's pattern). Async
   * work captures it on entry and re-checks at each await boundary — object
   * identity on `state` can't express "check again later without re-reading",
   * and a missed re-read after a future await insertion fails silently.
   */
  let generation = 0;
  const isStale = (capturedGeneration: number): boolean => generation !== capturedGeneration;
  /** Spans transport rebuilds on purpose — absorbs the deliberate since-overlap. */
  const dedupe = new LruSet(DEDUPE_LRU_SIZE);
  const awaitedPairings = new Map<string, ParsedNostrConnectUri>();
  const pendingContexts = new Map<string, PendingRequestContext>();
  const verdictCallbacks = new Set<OnUserVerdictNeeded>();
  let sweepTimer: ReturnType<typeof setInterval> | null = null;

  const connections = () => useNip46ConnectionsStore.getState();
  const requests = () => useNip46RequestsStore.getState();
  const activity = () => useNip46ActivityStore.getState();

  function relayUnion(): string[] {
    const urls = new Set<string>(deps.defaultRelays);
    for (const app of Object.values(connections().apps)) {
      if (app.status !== 'active') continue;
      for (const relay of app.relays) urls.add(relay);
    }
    for (const pairing of awaitedPairings.values()) {
      for (const relay of pairing.relays) urls.add(relay);
    }
    return [...urls];
  }

  function respond(
    toPubkey: string,
    response: RpcResponse,
    encryption: Nip46Encryption
  ): ResultAsync<void, Nip46TransportError> {
    return deps.transport.sendResponse({
      toPubkey,
      payloadJson: JSON.stringify(response),
      encryption,
    });
  }

  /** Skips `ping` — liveness chatter would churn the 500-entry capped log. */
  function logActivity(input: {
    clientPubkey: string;
    method: Nip46Method;
    kind?: number;
    verdict: ActivityVerdict;
    summary?: string;
    summaryV2?: Nip46ActivitySummaryV2;
    eventId?: string;
  }): void {
    if (input.method === 'ping') return;
    activity().logActivity(input);
  }

  function notifyVerdictNeeded(request: Nip46PendingRequest): void {
    for (const callback of verdictCallbacks) {
      const invoked = Result.fromThrowable(
        () => callback(request),
        (error) => redactError(error)
      )();
      if (invoked.isErr()) {
        nostrLog.warn('nostr.signer.engine_verdict_callback_failed', { error: invoked.error });
      }
    }
  }

  // ── Expiry sweep (runs only while the queue is non-empty) ─────

  function sweepExpired(): void {
    const due = requests().expireDue(deps.now());
    for (const expired of due) {
      const context = pendingContexts.get(expired.id);
      pendingContexts.delete(expired.id);
      // Connection drift since enqueue: a record that vanished (disconnect)
      // is unpaired and a blocked one is the silent tier — neither gets a
      // wire response, only the activity row below.
      const connection = connections().apps[expired.clientPubkey] ?? null;
      if (connection !== null && connection.status === 'active') {
        void respond(
          expired.clientPubkey,
          { id: expired.id, error: NIP46_ERRORS.requestExpired },
          context?.encryption ?? connection.encryption
        );
      }
      logActivity({
        clientPubkey: expired.clientPubkey,
        method: expired.method,
        ...(expired.kind !== undefined && { kind: expired.kind }),
        verdict: 'expired',
      });
      connections().touchUsage(expired.clientPubkey);
    }
    if (requests().pending.length === 0) stopSweep();
  }

  function ensureSweep(): void {
    if (sweepTimer !== null) return;
    sweepTimer = setInterval(sweepExpired, EXPIRY_SWEEP_INTERVAL_MS);
  }

  function stopSweep(): void {
    if (sweepTimer === null) return;
    clearInterval(sweepTimer);
    sweepTimer = null;
  }

  // ── Method execution + response ───────────────────────────────

  /**
   * Runs the post-verdict executor and responds. Execution failures answer
   * "malformed request" on the wire and log auto_denied_malformed — there is
   * no richer NIP-46 error vocabulary, and params are the usual culprit.
   */
  async function executeAndRespond(args: {
    engine: EngineState;
    clientPubkey: string;
    request: RpcRequest;
    kind?: number;
    encryption: Nip46Encryption;
    approveVerdict:
      | 'approved_once'
      | 'auto_approved_grant'
      | 'auto_approved_session'
      | 'auto_approved_peer_grant'
      | 'auto_approved_method';
    summary?: string;
    summaryV2?: Nip46ActivitySummaryV2;
    consumedGrantKey?: GrantKey;
    consumedPeerGrantPubkey?: string;
  }): Promise<void> {
    const { engine, clientPubkey, request, kind, encryption } = args;
    const capturedGeneration = generation;
    if (!isExecutableMethod(request.method)) return; // connect never reaches here
    const outcome = await methodHandlers[request.method]({
      signer: engine.signer,
      userPubkey: engine.userPubkey,
      request,
    });
    if (isStale(capturedGeneration)) return; // stopped/restarted mid-execution — never respond
    if (outcome.isErr()) {
      void respond(
        clientPubkey,
        { id: request.id, error: NIP46_ERRORS.malformedRequest },
        encryption
      );
      logActivity({
        clientPubkey,
        method: request.method,
        ...(kind !== undefined && { kind }),
        verdict: 'auto_denied_malformed',
      });
      connections().touchUsage(clientPubkey, { denied: true });
      return;
    }
    void respond(clientPubkey, { id: request.id, result: outcome.value }, encryption);
    const isNormalSign = args.summary !== undefined;
    const eventId =
      request.method === 'sign_event' && isNormalSign
        ? extractSignedEventId(outcome.value)
        : undefined;
    logActivity({
      clientPubkey,
      method: request.method,
      ...(kind !== undefined && { kind }),
      verdict: args.approveVerdict,
      ...(args.summary !== undefined && { summary: args.summary }),
      ...(args.summaryV2 !== undefined && { summaryV2: args.summaryV2 }),
      ...(eventId !== undefined && { eventId }),
    });
    connections().touchUsage(clientPubkey, {
      ...(args.consumedGrantKey !== undefined && { grantKey: args.consumedGrantKey }),
      ...(args.consumedPeerGrantPubkey !== undefined && {
        peerGrantPubkey: args.consumedPeerGrantPubkey,
      }),
    });
  }

  // ── Connect handshake (bunker pairing + duplicate-connect acks) ─

  async function handleConnect(args: {
    engine: EngineState;
    clientPubkey: string;
    request: RpcRequest;
    connection: Nip46Connection | null;
    encryption: Nip46Encryption;
    rateAllowed: boolean;
  }): Promise<void> {
    const { engine, clientPubkey, request, connection, encryption } = args;
    const capturedGeneration = generation;

    if (connection) {
      if (connection.status === 'blocked') {
        // Tier-1 silent drop: activity row only, never a response.
        logActivity({ clientPubkey, method: 'connect', verdict: 'auto_denied_blocked' });
        connections().touchUsage(clientPubkey, { denied: true });
        return;
      }
      if (!args.rateAllowed) {
        void respond(clientPubkey, { id: request.id, error: NIP46_ERRORS.rateLimited }, encryption);
        logActivity({ clientPubkey, method: 'connect', verdict: 'auto_denied_rate_limited' });
        connections().touchUsage(clientPubkey, { denied: true });
        return;
      }
      // Known client re-connect: ack + usage touch, no new record, no prompt.
      void respond(clientPubkey, { id: request.id, result: 'ack' }, encryption);
      connections().touchUsage(clientPubkey);
      logActivity({ clientPubkey, method: 'connect', verdict: 'auto_approved_method' });
      return;
    }

    // Stranger path — reached only because an unconsumed bunker secret is
    // outstanding (or a pairing is awaited). Under rate cooldown stay silent:
    // strangers have no standing to learn the signer exists.
    if (!args.rateAllowed) return;

    const secret = request.params[1]?.trim() ?? '';
    if (secret === '') {
      void respond(clientPubkey, { id: request.id, error: NIP46_ERRORS.invalidSecret }, encryption);
      return;
    }
    const consumed = await deps.consumeSecret(engine.userPubkey, secret);
    if (isStale(capturedGeneration)) return; // stopped/restarted during the consume await
    if (consumed.isErr()) {
      // Storage failure — consumption state unknown, so NEVER ack (a replayable
      // secret behind a successful pairing is worse than one lost re-scan).
      nostrLog.error('nostr.signer.engine_secret_consume_failed', {
        error: { type: consumed.error.type },
      });
      return;
    }
    if (!consumed.value) {
      void respond(clientPubkey, { id: request.id, error: NIP46_ERRORS.invalidSecret }, encryption);
      return;
    }

    // Secret deletion has landed (consume-then-ack). Create the connection,
    // then ack. Bunker URIs advertise the default relays, so the new record
    // starts on them.
    const upserted = connections().upsertApp({
      clientPubkey,
      relays: [...deps.defaultRelays],
      origin: 'bunker',
    });
    if (upserted.isErr()) {
      nostrLog.warn('nostr.signer.engine_bunker_upsert_failed', { cause: upserted.error });
      void respond(clientPubkey, { id: request.id, error: NIP46_ERRORS.notAuthorized }, encryption);
      return;
    }
    await respond(clientPubkey, { id: request.id, result: 'ack' }, encryption);
    if (isStale(capturedGeneration)) return; // stopped/restarted during the ack await
    logActivity({ clientPubkey, method: 'connect', verdict: 'approved_pairing' });
    const rebuilt = rebuildRelays();
    if (rebuilt.isErr()) {
      nostrLog.warn('nostr.signer.engine_rebuild_after_pairing_failed', {
        error: rebuilt.error.type,
      });
    }
  }

  // ── Request-shape validation (per-method params → kind/preview) ─

  function parseMethodParams(request: RpcRequest): Result<ParsedSignParams, 'malformed'> {
    if (request.method === 'sign_event') {
      const raw = request.params[0];
      if (raw === undefined) return err('malformed');
      const json = safeJsonParse(raw);
      if (json.isErr()) return err('malformed');
      const unsigned = UnsignedEventSchema.safeParse(json.value);
      if (!unsigned.success) return err('malformed');
      return ok({
        unsigned: unsigned.data,
        kind: unsigned.data.kind,
        preview: { type: 'sign_event', event: unsigned.data },
      });
    }
    if (request.method === 'nip04_encrypt' || request.method === 'nip44_encrypt') {
      const [peer, plaintext] = request.params;
      if (peer === undefined || plaintext === undefined || !isNostrPubkeyHex(peer)) {
        return err('malformed');
      }
      return ok({
        unsigned: null,
        kind: undefined,
        preview: { type: 'encrypt', peerPubkey: peer.toLowerCase(), plaintext },
      });
    }
    if (request.method === 'nip04_decrypt' || request.method === 'nip44_decrypt') {
      const [peer, ciphertext] = request.params;
      if (peer === undefined || ciphertext === undefined || !isNostrPubkeyHex(peer)) {
        return err('malformed');
      }
      return ok({
        unsigned: null,
        kind: undefined,
        preview: {
          type: 'decrypt',
          peerPubkey: peer.toLowerCase(),
          ciphertextLength: ciphertext.length,
        },
      });
    }
    return ok({ unsigned: null, kind: undefined, preview: { type: 'none' } });
  }

  // ── Inbound pipeline ──────────────────────────────────────────

  async function processEvent(event: NDKEvent): Promise<void> {
    const engine = state;
    if (!engine) return;
    const capturedGeneration = generation;
    const nowMs = deps.now();

    // 1. Envelope dedupe — marked immediately so replays cost one map lookup.
    const eventId = typeof event.id === 'string' ? event.id : '';
    if (eventId === '' || dedupe.has(`e:${eventId}`)) return;
    dedupe.add(`e:${eventId}`);

    // 2. created_at skew window (±300s) — replays outside the subscription
    // overlap die here even if the LRU has rotated.
    const createdAt = event.created_at;
    if (
      typeof createdAt !== 'number' ||
      Math.abs(Math.floor(nowMs / 1000) - createdAt) > CREATED_AT_SKEW_SEC
    ) {
      nostrLog.debug('nostr.signer.engine_skew_drop');
      return;
    }

    // 3. Sender lookup.
    const sender = typeof event.pubkey === 'string' ? event.pubkey.toLowerCase() : '';
    if (!isNostrPubkeyHex(sender)) return;
    const connection = connections().apps[sender] ?? null;
    const awaited = awaitedPairings.get(sender) ?? null;

    // 4. Stranger gate — before any crypto work. A stranger is processed only
    // while a bunker secret is outstanding (they may be the connect for it)
    // or their pubkey is an awaited nostrconnect pairing.
    if (!connection && !awaited) {
      const outstanding = await deps.hasOutstandingSecret(engine.userPubkey);
      if (isStale(capturedGeneration)) return; // stopped/restarted during the await
      if (outstanding.isErr() || !outstanding.value) {
        nostrLog.debug('nostr.signer.engine_stranger_drop');
        return;
      }
    }

    // 5. Signature verify — a cheap pre-filter (see file header); NDK caches
    // verify verdicts by id, so this is not the anti-spoofing gate — decrypt is.
    if (event.verifySignature(true) !== true) {
      nostrLog.warn('nostr.signer.engine_invalid_signature_drop');
      return;
    }

    // 6. Decrypt (pin first, fallback second); re-pin when the peer switched.
    const pinned: Nip46Encryption = connection?.encryption ?? 'nip44';
    const envelope = await deps.transport.decryptEnvelope(sender, event.content, pinned);
    if (envelope.isErr()) return; // transport already logged; silent per plan
    if (isStale(capturedGeneration)) return; // stopped/restarted during the decrypt await
    const { plaintext, used } = envelope.value;
    if (connection && used !== pinned) connections().setEncryption(sender, used);

    // 7. Rate limit — AFTER a successful decrypt (the ECDH decrypt authenticates
    // the sender), so a forged envelope spoofing a paired app's pubkey can never
    // burn that app's budget. Verdict applied post-parse so the response carries
    // the rpc id.
    const rate = deps.rateLimiter.take(sender);
    requests().setAppThrottled(sender, rate.throttled ? (rate.cooldownUntil ?? null) : null);

    // 8. RPC parse.
    const json = safeJsonParse(plaintext);
    if (json.isErr()) return;
    const rpc = RpcRequestSchema.safeParse(json.value);
    if (!rpc.success) {
      respondToUnparseable(json.value, sender, connection, awaited, used);
      return;
    }
    const request = rpc.data;

    // 9. RPC-id dedupe (same payload re-published under a fresh envelope id).
    const rpcKey = `r:${sender}:${request.id}`;
    if (dedupe.has(rpcKey)) return;
    dedupe.add(rpcKey);

    // 10. Handshake path.
    if (request.method === 'connect') {
      await handleConnect({
        engine,
        clientPubkey: sender,
        request,
        connection,
        encryption: used,
        rateAllowed: rate.allowed,
      });
      return;
    }

    // Strangers never get non-connect service — and never a response.
    if (!connection) {
      nostrLog.debug('nostr.signer.engine_stranger_method_drop');
      return;
    }

    // 11. Per-method param validation (kind extraction + safe preview).
    const parsedParams = parseMethodParams(request);
    if (parsedParams.isErr()) {
      // Blocked tier stays silent even for malformed payloads — only the
      // well-formed path below reaches evaluate(), which handles blocked,
      // so this branch must gate the response itself.
      if (connection.status === 'blocked') {
        logActivity({
          clientPubkey: sender,
          method: request.method,
          verdict: 'auto_denied_blocked',
        });
      } else {
        void respond(sender, { id: request.id, error: NIP46_ERRORS.malformedRequest }, used);
        logActivity({
          clientPubkey: sender,
          method: request.method,
          verdict: 'auto_denied_malformed',
        });
      }
      connections().touchUsage(sender, { denied: true });
      return;
    }
    const { unsigned, kind, preview } = parsedParams.value;

    // 12. Policy verdict.
    const decision = evaluate({
      connection,
      request: {
        method: request.method,
        kind,
        params: [...request.params],
        userPubkey: engine.userPubkey,
      },
      hasSessionGrant: (grantKey, peerPubkey) =>
        requests().hasSessionGrant(sender, grantKey, peerPubkey),
      hasSessionAllow: (grantKey) => requests().hasSessionAllow(sender, grantKey),
      rateLimit: { allowed: rate.allowed },
    });

    if (decision.verdict === 'deny') {
      // Blocked apps are a silent tier: activity row, no response.
      if (decision.reason !== 'blocked') {
        void respond(
          sender,
          { id: request.id, error: DENY_ERROR_BY_REASON[decision.reason] },
          used
        );
      }
      logActivity({
        clientPubkey: sender,
        method: request.method,
        ...(kind !== undefined && { kind }),
        verdict: decision.logVerdict,
      });
      connections().touchUsage(sender, { denied: true });
      return;
    }

    if (decision.verdict === 'allow') {
      const summary = summaryFor(decision, unsigned);
      const summaryV2 = summaryV2For(request.method, kind, preview);
      await executeAndRespond({
        engine,
        clientPubkey: sender,
        request,
        ...(kind !== undefined && { kind }),
        encryption: used,
        approveVerdict: decision.logVerdict,
        ...(summary !== undefined && { summary }),
        ...(summaryV2 !== undefined && { summaryV2 }),
        ...(decision.reason === 'grant_always' &&
          decision.grantKey !== undefined && { consumedGrantKey: decision.grantKey }),
        ...(decision.reason === 'peer_grant_always' &&
          decision.peerPubkey !== undefined && { consumedPeerGrantPubkey: decision.peerPubkey }),
      });
      return;
    }

    // 13. Ask — enqueue + module-scope resolver context.
    const pending: Nip46PendingRequest = {
      id: request.id,
      eventId,
      clientPubkey: sender,
      method: request.method,
      ...(kind !== undefined && { kind }),
      paramsPreview: preview,
      receivedAt: nowMs,
      expiresAt: nowMs + REQUEST_TTL_MS,
    };
    const enqueued = requests().enqueue(pending);
    if (enqueued.isErr()) {
      void respond(sender, { id: request.id, error: NIP46_ERRORS.rateLimited }, used);
      logActivity({
        clientPubkey: sender,
        method: request.method,
        ...(kind !== undefined && { kind }),
        verdict: 'auto_denied_rate_limited',
      });
      connections().touchUsage(sender, { denied: true });
      return;
    }
    const askSummary = summaryFor(decision, unsigned);
    const askSummaryV2 = summaryV2For(request.method, kind, preview);
    pendingContexts.set(request.id, {
      request,
      clientPubkey: sender,
      ...(kind !== undefined && { kind }),
      grantKey: decision.grantKey ?? null,
      isSelfDecrypt: decision.isSelfDecrypt === true,
      encryption: used,
      ...(askSummary !== undefined && { summary: askSummary }),
      ...(askSummaryV2 !== undefined && { summaryV2: askSummaryV2 }),
    });
    ensureSweep();
    notifyVerdictNeeded(pending);
  }

  function summaryFor(
    decision: PolicyDecision,
    unsigned: UnsignedEvent | null
  ): string | undefined {
    if (decision.class !== 'normal' || unsigned === null) return undefined;
    return unsigned.content.slice(0, SUMMARY_MAX_LENGTH);
  }

  /**
   * Structured human summary for the activity log, computed once at request
   * time (the params are gone by render time). No follow baseline here — the
   * kind-3 count-only fallback is the right activity copy regardless.
   */
  function summaryV2For(
    method: Nip46Method,
    kind: number | undefined,
    preview: Nip46ParamsPreview
  ): Nip46ActivitySummaryV2 | undefined {
    const summary = summarizeRequest({ method, ...(kind !== undefined && { kind }), preview });
    const refEventId = summary.referenced.noteIds[0];
    const refPubkey = preview.type === 'decrypt' ? preview.peerPubkey : undefined;
    if (
      summary.headline === undefined &&
      summary.activityLine === '' &&
      refEventId === undefined &&
      refPubkey === undefined
    ) {
      return undefined;
    }
    return {
      ...(summary.headline !== undefined && { headline: summary.headline }),
      ...(summary.activityLine !== '' && { line: summary.activityLine }),
      ...(refEventId !== undefined && { refEventId }),
      ...(refPubkey !== undefined && { refPubkey }),
    };
  }

  /**
   * Best-effort wire feedback for payloads that decrypted but failed the RPC
   * schema. Only paired or mid-pairing senders are answered, and only when a
   * sane id is recoverable; nothing is logged to activity (no parsed method
   * to attribute).
   */
  function respondToUnparseable(
    payload: unknown,
    sender: string,
    connection: Nip46Connection | null,
    awaited: ParsedNostrConnectUri | null,
    encryption: Nip46Encryption
  ): void {
    if (!connection && !awaited) return;
    if (connection?.status === 'blocked') return;
    if (typeof payload !== 'object' || payload === null) return;
    const { id, method } = payload as { id?: unknown; method?: unknown };
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return;
    const error =
      typeof method === 'string' && !isKnownMethod(method)
        ? NIP46_ERRORS.unsupportedMethod
        : NIP46_ERRORS.malformedRequest;
    void respond(sender, { id, error }, encryption);
  }

  function isKnownMethod(method: string): boolean {
    return method === 'connect' || Object.hasOwn(methodHandlers, method);
  }

  function onTransportEvent(event: NDKEvent): void {
    void processEvent(event).catch((error: unknown) => {
      // processEvent is Result-based throughout; this is the belt-and-braces
      // guard so a surprise throw can never produce an unhandled rejection.
      nostrLog.error('nostr.signer.engine_pipeline_failed', { error: redactError(error) });
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  function start(config: Nip46EngineStartConfig): Result<void, Nip46EngineError> {
    if (state) {
      nostrLog.debug('nostr.signer.engine_already_started');
      return ok(undefined);
    }
    const signer =
      config.signer instanceof Uint8Array ? new NDKPrivateKeySigner(config.signer) : config.signer;
    const engine: EngineState = {
      userPubkey: config.userPubkey.toLowerCase(),
      signer,
    };
    // State is live before the transport dials so even a synchronously
    // delivered event finds the engine ready; rolled back on start failure.
    generation += 1;
    state = engine;
    const sinceEpochSec = Math.floor(deps.now() / 1000) - CREATED_AT_SKEW_SEC;
    const started = deps.transport.start({
      signer,
      userPubkey: engine.userPubkey,
      relayUrls: relayUnion(),
      sinceEpochSec,
      onEvent: onTransportEvent,
    });
    if (started.isErr()) {
      state = null;
      return err({ type: 'transport', cause: started.error });
    }
    nostrLog.info('nostr.signer.engine_started');
    return ok(undefined);
  }

  function stop(): Result<void, Nip46EngineError> {
    if (!state) return ok(undefined);
    generation += 1; // strands every in-flight await at its next staleness check
    stopSweep();
    pendingContexts.clear();
    awaitedPairings.clear();
    requests().clear();
    state = null; // drops the key-holding signer reference
    const stopped = deps.transport.stop();
    nostrLog.info('nostr.signer.engine_stopped');
    if (stopped.isErr()) return err({ type: 'transport', cause: stopped.error });
    return ok(undefined);
  }

  function rebuildRelays(): Result<void, Nip46EngineError> {
    if (!state || !deps.transport.isStarted) return ok(undefined); // cold engine: next start picks the union up
    const rebuilt = deps.transport.rebuild(relayUnion());
    if (rebuilt.isErr()) return err({ type: 'transport', cause: rebuilt.error });
    return ok(undefined);
  }

  function reconnect(): Result<void, Nip46EngineError> {
    if (!state || !deps.transport.isStarted) return ok(undefined);
    // The transport computes the overlap-safe since itself (it owns
    // lastEventReceivedAt); the engine's dedupe LRU absorbs the redelivery.
    const reconnected = deps.transport.reconnect();
    if (reconnected.isErr()) return err({ type: 'transport', cause: reconnected.error });
    return ok(undefined);
  }

  // ── nostrconnect pairing ──────────────────────────────────────

  function startNostrconnectPairing(parsed: ParsedNostrConnectUri): Result<void, Nip46EngineError> {
    awaitedPairings.set(parsed.clientPubkey.toLowerCase(), parsed);
    nostrLog.info('nostr.signer.engine_pairing_awaited');
    return rebuildRelays();
  }

  function completeNostrconnectPairing(
    input: CompleteNostrconnectPairingInput
  ): ResultAsync<void, Nip46EngineError> {
    const engine = state;
    if (!engine) return errAsync(NOT_STARTED);
    const { parsed } = input;
    const clientPubkey = parsed.clientPubkey.toLowerCase();
    const nowMs = deps.now();

    const grants = Object.fromEntries(
      input.acceptedGrantKeys.map((grantKey) => [
        grantKey,
        { verdict: 'always' as const, origin: 'pairing' as const, createdAt: nowMs, useCount: 0 },
      ])
    );
    const upsertInput = {
      clientPubkey,
      relays: parsed.relays,
      origin: 'nostrconnect' as const,
      ...(parsed.name !== undefined && { name: parsed.name }),
      ...(parsed.url !== undefined && { url: parsed.url }),
      ...(parsed.image !== undefined && { image: parsed.image }),
      grants,
    };

    if (input.replacesClientPubkey !== undefined) {
      // SECURITY: the claimed identity is attacker-controllable, so the engine
      // re-derives the match itself against live store state — a forged
      // `replacesClientPubkey` can only ever point at the record this matcher
      // would pick. Any disagreement (record vanished, status flipped,
      // metadata no longer matches) FAILS the pairing rather than silently
      // degrading to a fresh upsert: the sheet promised restoration, and the
      // live subscription re-renders the correct variant for a retry.
      const previousKey = input.replacesClientPubkey.toLowerCase();
      const match = findPreviousConnection(connections().apps, parsed);
      if (match.kind === 'none' || match.connection.clientPubkey.toLowerCase() !== previousKey) {
        return errAsync({ type: 'adopt-failed', cause: 'inherit_mismatch' });
      }
      // Active previous → inherit the saved configuration; blocked previous →
      // deliberate fresh start (warned in the sheet), only attribution carries.
      const adopted = connections().adoptConnection(previousKey, upsertInput, {
        inheritGrants: match.kind === 'active',
      });
      if (adopted.isErr()) return errAsync({ type: 'adopt-failed', cause: adopted.error });
      // The replaced client's runtime leftovers: its timed decrypt grants die
      // with it; its pending requests resolve/expire silently (resolve-time
      // connection snapshots already treat a vanished record as unpaired).
      requests().revokeSessionGrant(previousKey);
      requests().setAppThrottled(previousKey, null);
    } else {
      // The store drops critical-always entries (its ceiling), caps relays, etc.
      const upserted = connections().upsertApp(upsertInput);
      if (upserted.isErr()) return errAsync({ type: 'upsert-failed', cause: upserted.error });
    }

    // Re-pair reconcile: a presented toggle the user UNCHECKED must downgrade a
    // standing 'always' grant back to ask (upsertApp merges additively, so it
    // can't do this itself). Scoped to presented keys and only to 'always' so
    // grants configured in the per-app editor (incl. 'deny') stay untouched.
    if (input.presentedGrantKeys !== undefined) {
      const accepted = new Set(input.acceptedGrantKeys);
      for (const grantKey of input.presentedGrantKeys) {
        if (accepted.has(grantKey)) continue;
        if (connections().apps[clientPubkey]?.grants[grantKey]?.verdict !== 'always') continue;
        const cleared = connections().setGrant(clientPubkey, grantKey, null);
        if (cleared.isErr()) {
          nostrLog.warn('nostr.signer.engine_grant_clear_failed', { cause: cleared.error });
        }
      }
    }

    awaitedPairings.delete(clientPubkey);
    const rebuilt = rebuildRelays();
    if (rebuilt.isErr()) return errAsync(rebuilt.error);

    // The nostrconnect handshake: WE publish connect echoing the URI secret;
    // the client validates result === secret. nip44 by default — the per-peer
    // pin re-aligns from the client's first inbound request if it is nip04-only.
    return respond(
      clientPubkey,
      { id: deps.mintRpcId(), result: parsed.secret },
      connections().apps[clientPubkey]?.encryption ?? 'nip44'
    )
      .map(() => {
        logActivity({ clientPubkey, method: 'connect', verdict: 'approved_pairing' });
        nostrLog.info('nostr.signer.engine_pairing_completed');
      })
      .mapErr((cause): Nip46EngineError => ({ type: 'transport', cause }));
  }

  function cancelNostrconnectPairing(clientPubkey: string): Result<void, Nip46EngineError> {
    if (!awaitedPairings.delete(clientPubkey.toLowerCase())) return ok(undefined);
    nostrLog.info('nostr.signer.engine_pairing_cancelled');
    return rebuildRelays();
  }

  // ── Deferred verdict resolution (called by the approval UI) ────
  // The decision→grants/response/activity mapping lives in verdictResolver;
  // the engine hands it this narrow seam over its module state.

  const resolverSeam: VerdictResolverSeam = {
    takeContext: (requestId) => {
      const context = pendingContexts.get(requestId);
      pendingContexts.delete(requestId);
      return context;
    },
    deleteContext: (requestId) => {
      pendingContexts.delete(requestId);
    },
    stopSweepIfIdle: () => {
      if (requests().pending.length === 0) stopSweep();
    },
    respond,
    logActivity,
    executeApproved: (context, encryption) => {
      const engine = state;
      if (!engine) return Promise.resolve(); // stopped between verdict and execution
      return executeAndRespond({
        engine,
        clientPubkey: context.clientPubkey,
        request: context.request,
        ...(context.kind !== undefined && { kind: context.kind }),
        encryption,
        approveVerdict: 'approved_once',
        ...(context.summary !== undefined && { summary: context.summary }),
        ...(context.summaryV2 !== undefined && { summaryV2: context.summaryV2 }),
      });
    },
  };

  function resolveRequest(
    requestId: string,
    decision: Nip46RequestDecision
  ): ResultAsync<void, Nip46EngineError> {
    if (!state) return errAsync(NOT_STARTED);
    return resolveVerdict(resolverSeam, requestId, decision);
  }

  function onUserVerdictNeeded(callback: OnUserVerdictNeeded): () => void {
    verdictCallbacks.add(callback);
    return () => {
      verdictCallbacks.delete(callback);
    };
  }

  return {
    get isStarted() {
      return state !== null;
    },
    start,
    stop,
    rebuildRelays,
    reconnect,
    startNostrconnectPairing,
    completeNostrconnectPairing,
    cancelNostrconnectPairing,
    resolveRequest,
    onUserVerdictNeeded,
  };
}

/**
 * The production singleton. UI layers import this; tests build their own via
 * createNip46Engine with injected deps.
 */
export const nip46Engine: Nip46Engine = createNip46Engine();
