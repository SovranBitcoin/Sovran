/**
 * @fileoverview NIP-46 permission policy
 *
 * Pure classify/evaluate — no IO, no react, no NDK. The engine feeds it a
 * parsed request plus connection/grant/rate state and acts on the decision.
 * Security invariant: the critical class can never yield 'allow' from a
 * persisted grant; only a runtime session grant (peer≠self decrypt) can.
 */

import { z } from 'zod';

import { safeJsonParse } from '@/features/nostrSigner/lib/json';
import {
  MAX_EVENT_KIND,
  NIP46_ERRORS,
  NIP46_RPC_KIND,
  type ConnectionMode,
  type ConnectionStatus,
  type EncryptionGrantKey,
  type GrantKey,
  type GrantVerdict,
  type Nip46ErrorString,
  type Nip46Method,
} from '@/features/nostrSigner/lib/nip46Types';

export type SensitivityClass = 'auto' | 'normal' | 'sensitive' | 'critical' | 'forbidden';

// 30023 (long-form articles) is public content — same risk class as kind 1.
const NORMAL_SIGN_KINDS = new Set([1, 6, 16, 7, 1111, 30023]);
const SENSITIVE_SIGN_KINDS = new Set([0, 3, 10002, 22242, 27235, 4, 13, 14, 1059, 9734, 30078]);
// NIP-60/61 wallet kinds — signing these can move or expose ecash.
const CRITICAL_SIGN_KINDS = new Set([17375, 7375, 7374, 7376, 9321, 10019]);
const DELETION_KIND = 5;

export interface ClassifyInput {
  method: Nip46Method;
  kind?: number;
  params?: string[];
  userPubkey?: string;
}

interface Classification {
  class: SensitivityClass;
  isSelfDecrypt: boolean;
}

// Classification only needs tags; never reuse this for signing-path validation.
const DeletionTagsSchema = z.looseObject({
  tags: z.array(z.array(z.string())),
});

/**
 * Kind 5 is sensitive, but escalates to critical when its deletion scope
 * cannot be verified as harmless: no `k` tag, an unparsable event, or any
 * `k` tag naming a critical kind — fail closed.
 */
function classifyDeletion(params: string[] | undefined): SensitivityClass {
  const raw = params?.[0];
  if (raw === undefined) return 'critical';
  const parsed = safeJsonParse(raw);
  if (parsed.isErr()) return 'critical';
  const shaped = DeletionTagsSchema.safeParse(parsed.value);
  if (!shaped.success) return 'critical';
  const kTags = shaped.data.tags.filter((tag) => tag[0] === 'k');
  if (kTags.length === 0) return 'critical';
  for (const tag of kTags) {
    const kind = Number(tag[1]);
    if (!Number.isInteger(kind) || CRITICAL_SIGN_KINDS.has(kind)) return 'critical';
  }
  return 'sensitive';
}

function classifySignKind(
  kind: number | undefined,
  params: string[] | undefined
): SensitivityClass {
  // Malformed sign_event (engine validates earlier); evaluate() denies it before any grant lookup.
  if (kind === undefined) return 'sensitive';
  if (kind === NIP46_RPC_KIND) return 'forbidden';
  if (kind === DELETION_KIND) return classifyDeletion(params);
  if (CRITICAL_SIGN_KINDS.has(kind)) return 'critical';
  if (NORMAL_SIGN_KINDS.has(kind)) return 'normal';
  if (SENSITIVE_SIGN_KINDS.has(kind)) return 'sensitive';
  return 'sensitive'; // unknown kinds default sensitive
}

/** Decrypt where the "peer" is the user's own pubkey — NIP-60 wallet payloads live there. */
function isSelfPeer(params: string[] | undefined, userPubkey: string | undefined): boolean {
  const peer = params?.[0];
  if (!peer || !userPubkey) return false;
  return peer.toLowerCase() === userPubkey.toLowerCase();
}

export function classifyRequest(input: ClassifyInput): Classification {
  const { method, kind, params, userPubkey } = input;
  switch (method) {
    case 'ping':
    case 'get_public_key':
    // The engine's handshake intercepts connect; an evaluate() pass-through
    // only acks duplicate connects from already-paired apps.
    case 'connect':
      return { class: 'auto', isSelfDecrypt: false };
    case 'nip04_encrypt':
    case 'nip44_encrypt':
      return { class: 'sensitive', isSelfDecrypt: false };
    case 'nip04_decrypt':
    case 'nip44_decrypt':
      // Ciphertext is opaque — could be wallet data — so decrypt is always critical.
      return { class: 'critical', isSelfDecrypt: isSelfPeer(params, userPubkey) };
    case 'sign_event':
      return { class: classifySignKind(kind, params), isSelfDecrypt: false };
  }
}

const SIGN_EVENT_GRANT_KEY_PREFIX = 'sign_event:';

/**
 * Inverse of `grantKeyFor`: split a stored grant key back into method + kind.
 * The single decoder for the `sign_event:<kind>` shape — classification,
 * catalog display, and the editor all consume this instead of re-slicing.
 */
export function parseGrantKey(grantKey: GrantKey): { method: Nip46Method; kind?: number } {
  if (grantKey.startsWith(SIGN_EVENT_GRANT_KEY_PREFIX)) {
    return {
      method: 'sign_event',
      kind: Number(grantKey.slice(SIGN_EVENT_GRANT_KEY_PREFIX.length)),
    };
  }
  return { method: grantKey as EncryptionGrantKey };
}

/** Persistent grant key for a request, or null for auto-class methods (never grantable). */
export function grantKeyFor(method: Nip46Method, kind?: number): GrantKey | null {
  switch (method) {
    case 'sign_event':
      return kind !== undefined && Number.isInteger(kind) && kind >= 0 && kind <= MAX_EVENT_KIND
        ? `sign_event:${kind}`
        : null;
    case 'nip04_encrypt':
    case 'nip04_decrypt':
    case 'nip44_encrypt':
    case 'nip44_decrypt':
      return method;
    case 'connect':
    case 'ping':
    case 'get_public_key':
      return null;
  }
}

/** Structural subset of a connections-store record — the store's richer shape is assignable. */
export interface PolicyConnection {
  status: ConnectionStatus;
  mode: ConnectionMode;
  grants: Partial<Record<GrantKey, { verdict: GrantVerdict }>>;
  /** Per-peer decrypt grants, keyed by lowercase peer pubkey hex. */
  peerDecryptGrants?: Record<string, { methods: readonly string[] }>;
}

export interface EvaluateInput {
  /** null = sender is not a connected app (engine should have dropped it; defense in depth). */
  connection: PolicyConnection | null;
  request: ClassifyInput;
  /** Runtime session-grant lookup (peer-scoped opt-in for peer≠self decrypts). */
  hasSessionGrant: (grantKey: GrantKey, peerPubkey: string) => boolean;
  /** Runtime session-allow lookup (non-decrypt keys; wallet sign kinds included). */
  hasSessionAllow: (grantKey: GrantKey) => boolean;
  rateLimit: { allowed: boolean };
}

export type PolicyAllowReason =
  | 'auto_method'
  | 'grant_always'
  | 'session_grant'
  | 'session_allow'
  | 'peer_grant_always';
export type PolicyDenyReason =
  | 'not_connected'
  | 'blocked'
  | 'rate_limited'
  | 'forbidden_kind'
  | 'grant_deny'
  | 'malformed';
export type PolicyAskReason = 'no_grant' | 'strict_mode' | 'critical_class' | 'self_decrypt';

interface PolicyDecisionBase {
  class: SensitivityClass;
  grantKey?: GrantKey;
  isSelfDecrypt?: boolean;
  /** Decrypt peer (lowercase hex) — set when a per-peer grant fired. */
  peerPubkey?: string;
}

export type PolicyDecision = PolicyDecisionBase &
  (
    | {
        verdict: 'allow';
        reason: PolicyAllowReason;
        logVerdict:
          | 'auto_approved_method'
          | 'auto_approved_grant'
          | 'auto_approved_session'
          | 'auto_approved_peer_grant';
      }
    | {
        verdict: 'deny';
        reason: PolicyDenyReason;
        logVerdict:
          | 'auto_denied_unauthorized'
          | 'auto_denied_blocked'
          | 'auto_denied_rate_limited'
          | 'auto_denied_forbidden'
          | 'auto_denied_grant'
          | 'auto_denied_malformed';
      }
    // 'prompt' is a placeholder — the final log verdict comes from the user's action.
    | { verdict: 'ask'; reason: PolicyAskReason; logVerdict: 'prompt' }
  );

/** Wire error string for each silent deny — the engine sends this in the RPC response. */
export const DENY_ERROR_BY_REASON: Record<PolicyDenyReason, Nip46ErrorString> = {
  not_connected: NIP46_ERRORS.notAuthorized,
  blocked: NIP46_ERRORS.notAuthorized,
  rate_limited: NIP46_ERRORS.rateLimited,
  forbidden_kind: NIP46_ERRORS.notAuthorized,
  grant_deny: NIP46_ERRORS.notAuthorized,
  malformed: NIP46_ERRORS.malformedRequest,
};

/**
 * Decision tree, mirroring the engine pipeline order:
 * connection → blocked → rate limit → forbidden → auto → grants.
 * 'deny' grants are honored in both modes; strict mode prompts everything
 * except auto; persisted 'always' never allows the critical class.
 */
export function evaluate(input: EvaluateInput): PolicyDecision {
  const { connection, request, hasSessionGrant, hasSessionAllow, rateLimit } = input;
  const { class: sensitivity, isSelfDecrypt } = classifyRequest(request);
  const common = { class: sensitivity, ...(isSelfDecrypt && { isSelfDecrypt: true }) };

  if (connection === null) {
    return {
      verdict: 'deny',
      reason: 'not_connected',
      logVerdict: 'auto_denied_unauthorized',
      ...common,
    };
  }
  if (connection.status === 'blocked') {
    return { verdict: 'deny', reason: 'blocked', logVerdict: 'auto_denied_blocked', ...common };
  }
  if (!rateLimit.allowed) {
    return {
      verdict: 'deny',
      reason: 'rate_limited',
      logVerdict: 'auto_denied_rate_limited',
      ...common,
    };
  }
  if (sensitivity === 'forbidden') {
    return {
      verdict: 'deny',
      reason: 'forbidden_kind',
      logVerdict: 'auto_denied_forbidden',
      ...common,
    };
  }
  if (sensitivity === 'auto') {
    return {
      verdict: 'allow',
      reason: 'auto_method',
      logVerdict: 'auto_approved_method',
      ...common,
    };
  }

  const grantKey = grantKeyFor(request.method, request.kind);
  if (grantKey === null) {
    return { verdict: 'deny', reason: 'malformed', logVerdict: 'auto_denied_malformed', ...common };
  }
  const withKey = { ...common, grantKey };

  const persisted = connection.grants[grantKey]?.verdict;
  if (persisted === 'deny') {
    return { verdict: 'deny', reason: 'grant_deny', logVerdict: 'auto_denied_grant', ...withKey };
  }
  if (connection.mode === 'strict') {
    return { verdict: 'ask', reason: 'strict_mode', logVerdict: 'prompt', ...withKey };
  }
  if (isSelfDecrypt) {
    // BEFORE any peer-grant honoring: even a tampered peerDecryptGrants entry
    // keyed on the user's own pubkey can never auto-approve a self-decrypt.
    return { verdict: 'ask', reason: 'self_decrypt', logVerdict: 'prompt', ...withKey };
  }
  // Per-peer grants exist only for peer≠self decrypts; a stray entry for any
  // other key must not silently approve a critical sign. Both lookups are
  // peer-scoped — a grant for one conversation never covers another.
  const sessionEligible = request.method === 'nip04_decrypt' || request.method === 'nip44_decrypt';
  const decryptPeer = sessionEligible ? request.params?.[0]?.toLowerCase() : undefined;
  if (sessionEligible && decryptPeer !== undefined) {
    const withPeer = { ...withKey, peerPubkey: decryptPeer };
    if (hasSessionGrant(grantKey, decryptPeer)) {
      return {
        verdict: 'allow',
        reason: 'session_grant',
        logVerdict: 'auto_approved_session',
        ...withPeer,
      };
    }
    const peerGrant = connection.peerDecryptGrants?.[decryptPeer];
    if (peerGrant?.methods.includes(request.method)) {
      return {
        verdict: 'allow',
        reason: 'peer_grant_always',
        logVerdict: 'auto_approved_peer_grant',
        ...withPeer,
      };
    }
  }
  // Session allows (runtime-only, non-decrypt keys) sit ABOVE the persisted
  // critical ceiling on purpose: wallet sign kinds may be session-allowed —
  // a restart always re-prompts — while a PERSISTED always on critical stays
  // unrepresentable. Deny grants, strict mode, and self-decrypt already won
  // above this line.
  if (hasSessionAllow(grantKey)) {
    return {
      verdict: 'allow',
      reason: 'session_allow',
      logVerdict: 'auto_approved_session',
      ...withKey,
    };
  }
  if (persisted === 'always') {
    if (sensitivity === 'critical') {
      // Unreachable through store actions (schema refine blocks critical
      // 'always'); a tampered blob still cannot silently sign. Critical is
      // never allowed by a PERSISTED grant — only runtime session state.
      return { verdict: 'ask', reason: 'critical_class', logVerdict: 'prompt', ...withKey };
    }
    return {
      verdict: 'allow',
      reason: 'grant_always',
      logVerdict: 'auto_approved_grant',
      ...withKey,
    };
  }
  return {
    verdict: 'ask',
    reason: sensitivity === 'critical' ? 'critical_class' : 'no_grant',
    logVerdict: 'prompt',
    ...withKey,
  };
}
