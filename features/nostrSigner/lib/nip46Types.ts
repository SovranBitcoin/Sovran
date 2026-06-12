/**
 * @fileoverview NIP-46 shared contracts
 *
 * Module-scope zod schemas, inferred types, and tuning constants for the
 * remote-signer feature. Every other nostrSigner module imports from here;
 * this file imports nothing but zod.
 */

import { z } from 'zod';

/** NIP-46 RPC envelope event kind. Signing this kind is forbidden (response forgery). */
export const NIP46_RPC_KIND = 24133;

// Queue & replay hygiene
export const REQUEST_TTL_MS = 120_000;
export const MAX_PENDING_PER_APP = 10;
export const MAX_PENDING_GLOBAL = 25;
export const RATE_PER_APP_PER_MIN = 30;
export const RATE_GLOBAL_PER_MIN = 120;
export const CREATED_AT_SKEW_SEC = 300;

// Activity log retention
export const ACTIVITY_CAP = 500;
export const ACTIVITY_MAX_AGE_DAYS = 30;
/** Max length of the engine-curated activity summary (normal-class sign_event). */
export const SUMMARY_MAX_LENGTH = 80;

// Pairing & connection limits
export const MAX_CONNECTED_APPS = 64;
export const BUNKER_SECRET_TTL_MS = 600_000;
export const PAIRING_INTENT_TTL_MS = 600_000;

/** Per-app cap on persisted per-peer decrypt grants (writes beyond it reject). */
export const MAX_PEER_DECRYPT_GRANTS_PER_APP = 50;

/**
 * Cap on the replaced-client-key attribution chain a connection carries
 * (`previousClientPubkeys`) — most recent kept, oldest dropped.
 */
export const MAX_PREVIOUS_CLIENT_PUBKEYS = 8;

/** Wire error strings sent in RPC responses. Clients match on these — do not reword. */
export const NIP46_ERRORS = {
  notAuthorized: 'Not authorized',
  invalidSecret: 'invalid secret',
  rateLimited: 'rate limited',
  requestExpired: 'request expired',
  unsupportedMethod: 'unsupported method',
  malformedRequest: 'malformed request',
} as const;
export type Nip46ErrorString = (typeof NIP46_ERRORS)[keyof typeof NIP46_ERRORS];

export const Nip46MethodSchema = z.enum([
  'connect',
  'sign_event',
  'ping',
  'get_public_key',
  'nip04_encrypt',
  'nip04_decrypt',
  'nip44_encrypt',
  'nip44_decrypt',
]);
export type Nip46Method = z.infer<typeof Nip46MethodSchema>;

const RpcIdSchema = z.string().min(1).max(64);

// Params can carry a full event JSON (sign_event) — bound generously, not tightly.
const MAX_RPC_PARAM_LENGTH = 131_072;
const MAX_RPC_PARAMS = 16;

/** Decrypted content of an inbound kind-24133 request. */
export const RpcRequestSchema = z.object({
  id: RpcIdSchema,
  method: Nip46MethodSchema,
  params: z.array(z.string().max(MAX_RPC_PARAM_LENGTH)).max(MAX_RPC_PARAMS),
});
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

/** Outbound response payload (encrypted into a kind-24133 event). */
export const RpcResponseSchema = z.object({
  id: RpcIdSchema,
  result: z.string().max(MAX_RPC_PARAM_LENGTH).optional(),
  error: z.string().max(1024).optional(),
});
export type RpcResponse = z.infer<typeof RpcResponseSchema>;

export const MAX_EVENT_KIND = 65535;

export const EventKindSchema = z.int().min(0).max(MAX_EVENT_KIND);

/**
 * sign_event params[0] after JSON.parse. Loose: clients may include pubkey/id.
 * created_at upper bound = 2100-01-01 (seconds) — rejects millisecond timestamps.
 */
export const UnsignedEventSchema = z.looseObject({
  kind: EventKindSchema,
  content: z.string().max(131_072),
  tags: z.array(z.array(z.string().max(4096)).max(256)).max(10_000),
  created_at: z.int().min(0).max(4_102_444_800),
});
export type UnsignedEvent = z.infer<typeof UnsignedEventSchema>;

export const GrantVerdictSchema = z.enum(['always', 'deny']);
export type GrantVerdict = z.infer<typeof GrantVerdictSchema>;

export const ConnectionModeSchema = z.enum(['standard', 'strict']);
export type ConnectionMode = z.infer<typeof ConnectionModeSchema>;

export const ConnectionStatusSchema = z.enum(['active', 'blocked']);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

/** The two decrypt envelope methods — the only per-peer-grantable surface. */
export type DecryptMethod = 'nip04_decrypt' | 'nip44_decrypt';

/** Methods that can hold a standing grant without a kind qualifier. */
export const ENCRYPTION_GRANT_METHODS = [
  'nip04_encrypt',
  'nip04_decrypt',
  'nip44_encrypt',
  'nip44_decrypt',
] as const;
export type EncryptionGrantKey = (typeof ENCRYPTION_GRANT_METHODS)[number];

/**
 * Persistent grant identifier. The kind qualifier on sign_event is mandatory —
 * a wildcard `sign_event` grant is unrepresentable at both type and runtime
 * level (`grantKeyFor` is the only constructor; this guard is the validator).
 */
export type SignEventGrantKey = `sign_event:${number}`;
export type GrantKey = SignEventGrantKey | EncryptionGrantKey;

// No leading zeros, max 5 digits; range-checked against MAX_EVENT_KIND below.
const SIGN_EVENT_GRANT_KEY_RE = /^sign_event:(0|[1-9]\d{0,4})$/;

export function isGrantKey(value: string): value is GrantKey {
  if ((ENCRYPTION_GRANT_METHODS as readonly string[]).includes(value)) return true;
  const match = SIGN_EVENT_GRANT_KEY_RE.exec(value);
  if (!match) return false;
  return Number(match[1]) <= MAX_EVENT_KIND;
}

export const GrantKeySchema = z.custom<GrantKey>(
  (value) => typeof value === 'string' && isGrantKey(value),
  'invalid grant key'
);

/** One parsed token of the nostrconnect `perms` CSV (`method[:kind]`). */
export const PermTokenSchema = z.strictObject({
  method: Nip46MethodSchema,
  kind: EventKindSchema.optional(),
});
export type PermToken = z.infer<typeof PermTokenSchema>;

/**
 * Activity-log verdicts. `auto_*` values are produced by
 * `permissionPolicy.evaluate`; the rest by user action or queue expiry.
 */
export const ActivityVerdictSchema = z.enum([
  'approved_once',
  'approved_pairing',
  'auto_approved_grant',
  'auto_approved_session',
  'auto_approved_peer_grant',
  'auto_approved_method',
  'denied_once',
  'auto_denied_blocked',
  'auto_denied_grant',
  'auto_denied_forbidden',
  'auto_denied_unauthorized',
  'auto_denied_rate_limited',
  'auto_denied_malformed',
  'expired',
]);
export type ActivityVerdict = z.infer<typeof ActivityVerdictSchema>;
