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
 *   → SIGNATURE VERIFY — earlier than the plan's nominal slot, deliberately:
 *     a forged envelope spoofing a paired app's pubkey must not consume that
 *     app's rate budget (spoofed-sender rate-limit DoS) nor trigger decrypt
 *     work. It still sits after the connection/secret gates so unsolicited
 *     traffic dies on cheap map lookups before any schnorr math. Verification
 *     is NDKEvent.verifySignature(true) — synchronous on the dedicated
 *     transport NDK (no asyncSigVerification), and a no-op re-read when the
 *     relay layer already verified.
 *   → rateLimiter.take → decrypt (per-peer pin, fallback; re-pin on mismatch)
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

import { useNip46ActivityStore } from '@/features/nostrSigner/data/nip46ActivityStore';
import {
  useNip46ConnectionsStore,
  type Nip46Connection,
  type UpsertAppError,
} from '@/features/nostrSigner/data/nip46ConnectionsStore';
import {
  useNip46RequestsStore,
  type Nip46ParamsPreview,
  type Nip46PendingRequest,
  type SessionGrantKey,
} from '@/features/nostrSigner/data/nip46RequestsStore';
import {
  consumeSecret as consumeBunkerSecret,
  hasOutstanding as hasOutstandingBunkerSecret,
  type BunkerSecretsError,
} from '@/features/nostrSigner/lib/bunkerSecrets';
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
import { nostrLog, redactError } from '@/shared/lib/logger';
import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';
import { relays as defaultSignerRelays } from '@/shared/ndk';

export const DEDUPE_LRU_SIZE = 512;
export const EXPIRY_SWEEP_INTERVAL_MS = 10_000;
const SUMMARY_MAX_LENGTH = 80;

// ── Public types ────────────────────────────────────────────────

export type Nip46EngineError =
  | { type: 'not-started' }
  | { type: 'transport'; cause: Nip46TransportError }
  | { type: 'unknown-request' }
  | { type: 'upsert-failed'; cause: UpsertAppError };

export interface Nip46EngineStartConfig {
  /** Raw bytes are wrapped into an NDKPrivateKeySigner; held only in module state. */
  signer: NDKPrivateKeySigner | Uint8Array;
  /** Hex pubkey of the active profile (= remote-signer pubkey, Amber model). */
  userPubkey: string;
  /** Active profile's derivation index — carried for pairing intents. */
  accountIndex: number;
}

export type Nip46DecisionAction = 'approve_once' | 'always' | 'deny_once' | 'always_deny' | 'block';

export interface Nip46RequestDecision {
  action: Nip46DecisionAction;
  /**
   * Opt-in 1h runtime grant — honored only for peer≠self decrypt requests
   * (the requests store re-checks both invariants).
   */
  sessionGrant?: boolean;
}

export interface CompleteNostrconnectPairingInput {
  parsed: ParsedNostrConnectUri;
  /** Perm toggles the user accepted — persisted as always-grants (origin 'pairing'). */
  acceptedGrantKeys: readonly GrantKey[];
}

/** Structural subset of Nip46Transport the engine drives — injectable in tests. */
export interface Nip46EngineTransport {
  readonly isStarted: boolean;
  readonly lastEventReceivedAt: number | null;
  start(params: {
    signer: NDKPrivateKeySigner | Uint8Array;
    userPubkey: string;
    relayUrls: readonly string[];
    sinceEpochSec: number;
    onEvent: (event: NDKEvent) => void;
  }): Result<void, Nip46TransportError>;
  rebuild(relayUrls: readonly string[]): Result<void, Nip46TransportError>;
  reconnect(sinceEpochSec: number): Result<void, Nip46TransportError>;
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

const safeJsonParse = Result.fromThrowable(
  (raw: string) => JSON.parse(raw) as unknown,
  () => 'invalid_json' as const
);

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
  accountIndex: number;
  signer: NDKPrivateKeySigner;
}

/** Everything needed to execute/respond when the user (or sweep) resolves an ask. */
interface PendingRequestContext {
  request: RpcRequest;
  clientPubkey: string;
  kind?: number;
  grantKey: GrantKey | null;
  isSelfDecrypt: boolean;
  encryption: Nip46Encryption;
  /** Pre-truncated content snippet — present only for normal-class sign_event. */
  summary?: string;
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
      | 'auto_approved_method';
    summary?: string;
    consumedGrantKey?: GrantKey;
  }): Promise<void> {
    const { engine, clientPubkey, request, kind, encryption } = args;
    if (!isExecutableMethod(request.method)) return; // connect never reaches here
    const outcome = await methodHandlers[request.method]({
      signer: engine.signer,
      userPubkey: engine.userPubkey,
      request,
    });
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
      ...(eventId !== undefined && { eventId }),
    });
    connections().touchUsage(
      clientPubkey,
      args.consumedGrantKey !== undefined ? { grantKey: args.consumedGrantKey } : undefined
    );
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
      if (outstanding.isErr() || !outstanding.value) {
        nostrLog.debug('nostr.signer.engine_stranger_drop');
        return;
      }
    }

    // 5. Signature verify — see file header for why this precedes rate/decrypt.
    if (event.verifySignature(true) !== true) {
      nostrLog.warn('nostr.signer.engine_invalid_signature_drop');
      return;
    }

    // 6. Rate limit (verdict applied post-parse so the response carries the rpc id).
    const rate = deps.rateLimiter.take(sender);
    requests().setAppThrottled(sender, rate.throttled);

    // 7. Decrypt (pin first, fallback second); re-pin when the peer switched.
    const pinned: Nip46Encryption = connection?.encryption ?? 'nip44';
    const envelope = await deps.transport.decryptEnvelope(sender, event.content, pinned);
    if (envelope.isErr()) return; // transport already logged; silent per plan
    const { plaintext, used } = envelope.value;
    if (connection && used !== pinned) connections().setEncryption(sender, used);

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
      hasSessionGrant: (grantKey) => requests().hasSessionGrant(sender, grantKey, nowMs),
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
      await executeAndRespond({
        engine,
        clientPubkey: sender,
        request,
        ...(kind !== undefined && { kind }),
        encryption: used,
        approveVerdict: decision.logVerdict,
        ...(summary !== undefined && { summary }),
        ...(decision.reason === 'grant_always' &&
          decision.grantKey !== undefined && { consumedGrantKey: decision.grantKey }),
      });
      return;
    }

    // 13. Ask — enqueue + module-scope resolver context.
    const pending: Nip46PendingRequest = {
      id: request.id,
      eventId,
      clientPubkey: sender,
      connectionKnown: true,
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
    pendingContexts.set(request.id, {
      request,
      clientPubkey: sender,
      ...(kind !== undefined && { kind }),
      grantKey: decision.grantKey ?? null,
      isSelfDecrypt: decision.isSelfDecrypt === true,
      encryption: used,
      ...(decision.class === 'normal' && unsigned !== null
        ? { summary: unsigned.content.slice(0, SUMMARY_MAX_LENGTH) }
        : {}),
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
      accountIndex: config.accountIndex,
      signer,
    };
    // State is live before the transport dials so even a synchronously
    // delivered event finds the engine ready; rolled back on start failure.
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
    const skewedNowSec = Math.floor(deps.now() / 1000) - CREATED_AT_SKEW_SEC;
    const lastEventMs = deps.transport.lastEventReceivedAt;
    const sinceEpochSec =
      lastEventMs === null ? skewedNowSec : Math.min(skewedNowSec, Math.floor(lastEventMs / 1000));
    const reconnected = deps.transport.reconnect(sinceEpochSec);
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
    // The store drops critical-always entries (its ceiling), caps relays, etc.
    const upserted = connections().upsertApp({
      clientPubkey,
      relays: parsed.relays,
      origin: 'nostrconnect',
      ...(parsed.name !== undefined && { name: parsed.name }),
      ...(parsed.url !== undefined && { url: parsed.url }),
      ...(parsed.image !== undefined && { image: parsed.image }),
      grants,
    });
    if (upserted.isErr()) return errAsync({ type: 'upsert-failed', cause: upserted.error });

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

  function resolveRequest(
    requestId: string,
    decision: Nip46RequestDecision
  ): ResultAsync<void, Nip46EngineError> {
    const engine = state;
    if (!engine) return errAsync(NOT_STARTED);
    const context = pendingContexts.get(requestId);
    if (!context) return errAsync({ type: 'unknown-request' });
    pendingContexts.delete(requestId);
    requests().remove(requestId);
    if (requests().pending.length === 0) stopSweep();

    const { clientPubkey, request } = context;
    const connection = connections().apps[clientPubkey] ?? null;
    const encryption = connection?.encryption ?? context.encryption;

    const finish = (work: Promise<void>): ResultAsync<void, Nip46EngineError> =>
      ResultAsync.fromPromise(work, (error): Nip46EngineError => {
        nostrLog.error('nostr.signer.engine_resolve_failed', { error: redactError(error) });
        return { type: 'unknown-request' };
      });

    const denyOnce = (): Promise<void> => {
      // Respond only while the snapshot taken at resolve time is an active
      // pairing: a vanished record is unpaired and a since-blocked one is the
      // silent tier. The 'block' action relies on the snapshot semantics —
      // `connection` was read BEFORE blockApp() flipped the store, so the
      // prompted request still gets its documented final "Not authorized"
      // while everything the app sends afterwards is silent.
      if (connection !== null && connection.status === 'active') {
        void respond(
          clientPubkey,
          { id: request.id, error: NIP46_ERRORS.notAuthorized },
          encryption
        );
      }
      logActivity({
        clientPubkey,
        method: request.method,
        ...(context.kind !== undefined && { kind: context.kind }),
        verdict: 'denied_once',
      });
      connections().touchUsage(clientPubkey, { denied: true });
      return Promise.resolve();
    };

    switch (decision.action) {
      case 'deny_once':
        return finish(denyOnce());

      case 'always_deny': {
        if (context.grantKey !== null) {
          const written = connections().setGrant(clientPubkey, context.grantKey, 'deny');
          if (written.isErr()) {
            nostrLog.warn('nostr.signer.engine_grant_write_failed', { cause: written.error });
          }
        }
        return finish(denyOnce());
      }

      case 'block': {
        connections().blockApp(clientPubkey);
        // The prompted request gets a final answer; everything else the app
        // queued is flushed silently (blocked tier = activity rows only).
        for (const other of requests().pending.filter((p) => p.clientPubkey === clientPubkey)) {
          pendingContexts.delete(other.id);
          requests().remove(other.id);
          logActivity({
            clientPubkey,
            method: other.method,
            ...(other.kind !== undefined && { kind: other.kind }),
            verdict: 'auto_denied_blocked',
          });
        }
        if (requests().pending.length === 0) stopSweep();
        return finish(denyOnce());
      }

      case 'approve_once':
      case 'always': {
        // A connection that vanished or got blocked mid-prompt must not sign.
        if (connection === null) {
          // Disconnected mid-prompt: the pubkey is unpaired now, so no wire
          // response (the client times out, exactly as if the signer left).
          nostrLog.debug('nostr.signer.engine_resolve_disconnected_drop');
          return finish(Promise.resolve());
        }
        if (connection.status === 'blocked') {
          // Blocked tier: silent activity row, no response.
          logActivity({
            clientPubkey,
            method: request.method,
            ...(context.kind !== undefined && { kind: context.kind }),
            verdict: 'auto_denied_blocked',
          });
          return finish(Promise.resolve());
        }
        if (decision.action === 'always' && context.grantKey !== null) {
          // The store rejects critical-always (the ceiling); the user's
          // one-time approval still executes below.
          const written = connections().setGrant(clientPubkey, context.grantKey, 'always');
          if (written.isErr()) {
            nostrLog.warn('nostr.signer.engine_grant_write_failed', { cause: written.error });
          }
        }
        if (
          decision.sessionGrant === true &&
          !context.isSelfDecrypt &&
          (request.method === 'nip04_decrypt' || request.method === 'nip44_decrypt')
        ) {
          const granted = requests().grantSession(
            clientPubkey,
            request.method as SessionGrantKey,
            { peerIsSelf: false },
            deps.now()
          );
          if (granted.isErr()) {
            nostrLog.warn('nostr.signer.engine_session_grant_rejected', { cause: granted.error });
          }
        }
        return finish(
          executeAndRespond({
            engine,
            clientPubkey,
            request,
            ...(context.kind !== undefined && { kind: context.kind }),
            encryption,
            approveVerdict: 'approved_once',
            ...(context.summary !== undefined && { summary: context.summary }),
          })
        );
      }
    }
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
