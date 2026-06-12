/**
 * @fileoverview NIP-46 post-verdict method executors
 *
 * One handler per executable RPC method, run by the engine strictly AFTER a
 * verdict allows execution (auto-grant, session grant, or an explicit user
 * approval). `connect` is deliberately absent — the pairing handshake lives in
 * the engine, where secrets and connection records are in scope.
 *
 * sign_event signs EXACTLY what the client sent. NDKEvent.sign is NOT used:
 * its toNostrEvent → generateTags path rewrites content and injects tags
 * (client tag, d-tag minting — verified in @nostr-dev-kit/ndk 2.11.0
 * dist/index.mjs), which would make the signer alter the event it was asked
 * to sign. Instead the unsigned event is validated, canonically serialized
 * per NIP-01 ([0, pubkey, created_at, kind, tags, content] → sha256 → id),
 * and signed with NDKPrivateKeySigner.sign(NostrEvent) — which delegates to
 * nostr-tools finalizeEvent over the same canonical fields, so the returned
 * sig matches the id computed here.
 *
 * The signer is handed in per call and never stored, logged, or echoed.
 * Plaintexts, ciphertexts, and event payloads never reach the log — error
 * paths log redacted causes and zod issue paths only.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { NDKUser } from '@nostr-dev-kit/ndk-mobile';
import type { NDKPrivateKeySigner, NostrEvent } from '@nostr-dev-kit/ndk-mobile';
import { err, errAsync, ok, okAsync, Result, ResultAsync } from 'neverthrow';

import { safeJsonParse } from '@/features/nostrSigner/lib/json';
import {
  UnsignedEventSchema,
  type Nip46Method,
  type RpcRequest,
  type UnsignedEvent,
} from '@/features/nostrSigner/lib/nip46Types';
import { nostrLog, redactError, type RedactedError } from '@/shared/lib/logger';
import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';

type Nip46MethodHandlerError =
  | { type: 'malformed-params' }
  | { type: 'execution-failed'; cause: RedactedError };

const MALFORMED: Nip46MethodHandlerError = { type: 'malformed-params' };

interface Nip46MethodHandlerInput {
  /** The user's signing key — passed through, never retained. */
  signer: NDKPrivateKeySigner;
  /** Hex pubkey of the active profile (= the remote-signer pubkey). */
  userPubkey: string;
  request: RpcRequest;
}

/** Resolves to the RPC `result` string for the response payload. */
type Nip46MethodHandler = (
  input: Nip46MethodHandlerInput
) => ResultAsync<string, Nip46MethodHandlerError>;

/** Every RPC method with a post-verdict executor (connect is engine-only). */
export type Nip46ExecutableMethod = Exclude<Nip46Method, 'connect'>;

export function isExecutableMethod(method: Nip46Method): method is Nip46ExecutableMethod {
  return method !== 'connect';
}

const executionFailure =
  (logEvent: string) =>
  (error: unknown): Nip46MethodHandlerError => {
    const cause = redactError(error);
    nostrLog.warn(logEvent, { error: cause });
    return { type: 'execution-failed', cause };
  };

// ── sign_event ──────────────────────────────────────────────────

/** NIP-01 canonical serialization — the array NDK/nostr-tools hash for the id. */
function nip01EventId(event: NostrEvent): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return bytesToHex(sha256(utf8ToBytes(serialized)));
}

function parseUnsignedEvent(
  raw: string | undefined,
  userPubkey: string
): Result<UnsignedEvent, Nip46MethodHandlerError> {
  if (raw === undefined) return err(MALFORMED);
  const json = safeJsonParse(raw);
  if (json.isErr()) return err(MALFORMED);
  const parsed = UnsignedEventSchema.safeParse(json.value);
  if (!parsed.success) {
    // Issue paths only — the event payload must never reach the log.
    nostrLog.warn('nostr.signer.sign_event_invalid', {
      issues: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
    return err(MALFORMED);
  }
  // A client-claimed author that is not the signing identity is a request to
  // forge — reject instead of silently re-attributing. Empty string is the
  // common "fill it in for me" convention and is treated as absent.
  const claimed = (json.value as { pubkey?: unknown }).pubkey;
  if (typeof claimed === 'string' && claimed !== '' && claimed.toLowerCase() !== userPubkey) {
    nostrLog.warn('nostr.signer.sign_event_pubkey_mismatch');
    return err(MALFORMED);
  }
  return ok(parsed.data);
}

const signEvent: Nip46MethodHandler = ({ signer, userPubkey, request }) => {
  const pubkey = userPubkey.toLowerCase();
  const unsigned = parseUnsignedEvent(request.params[0], pubkey);
  if (unsigned.isErr()) return errAsync(unsigned.error);

  // Canonical fields only: client-supplied id/sig/extra keys are discarded,
  // and the signed result is rebuilt from exactly what was validated.
  const template: NostrEvent = {
    pubkey,
    created_at: unsigned.value.created_at,
    kind: unsigned.value.kind,
    tags: unsigned.value.tags,
    content: unsigned.value.content,
  };
  return ResultAsync.fromPromise(
    signer.sign(template),
    executionFailure('nostr.signer.sign_event_failed')
  ).map((sig) => JSON.stringify({ ...template, id: nip01EventId(template), sig }));
};

/** Signed-event id from a sign_event result string, for activity logging. */
export function extractSignedEventId(resultJson: string): string | undefined {
  const parsed = safeJsonParse(resultJson);
  if (parsed.isErr()) return undefined;
  const id = (parsed.value as { id?: unknown }).id;
  return typeof id === 'string' && isNostrPubkeyHex(id) ? id : undefined;
}

// ── nip04 / nip44 encrypt & decrypt ─────────────────────────────

interface PeerParams {
  peer: NDKUser;
  payload: string;
}

function parsePeerParams(request: RpcRequest): Result<PeerParams, Nip46MethodHandlerError> {
  const [peerPubkey, payload] = request.params;
  if (peerPubkey === undefined || payload === undefined || !isNostrPubkeyHex(peerPubkey)) {
    return err(MALFORMED);
  }
  return ok({ peer: new NDKUser({ pubkey: peerPubkey.toLowerCase() }), payload });
}

type PeerCrypto = (signer: NDKPrivateKeySigner, peer: NDKUser, payload: string) => Promise<string>;

const peerCryptoHandler =
  (run: PeerCrypto, logEvent: string): Nip46MethodHandler =>
  ({ signer, request }) => {
    const params = parsePeerParams(request);
    if (params.isErr()) return errAsync(params.error);
    const { peer, payload } = params.value;
    return ResultAsync.fromPromise(run(signer, peer, payload), executionFailure(logEvent));
  };

// ── Handler table ───────────────────────────────────────────────

export const methodHandlers: Record<Nip46ExecutableMethod, Nip46MethodHandler> = {
  sign_event: signEvent,
  ping: () => okAsync('pong'),
  get_public_key: ({ userPubkey }) => okAsync(userPubkey.toLowerCase()),
  nip04_encrypt: peerCryptoHandler(
    (signer, peer, payload) => signer.nip04Encrypt(peer, payload),
    'nostr.signer.nip04_encrypt_failed'
  ),
  nip04_decrypt: peerCryptoHandler(
    (signer, peer, payload) => signer.nip04Decrypt(peer, payload),
    'nostr.signer.nip04_decrypt_failed'
  ),
  nip44_encrypt: peerCryptoHandler(
    (signer, peer, payload) => signer.nip44Encrypt(peer, payload),
    'nostr.signer.nip44_encrypt_failed'
  ),
  nip44_decrypt: peerCryptoHandler(
    (signer, peer, payload) => signer.nip44Decrypt(peer, payload),
    'nostr.signer.nip44_decrypt_failed'
  ),
};
