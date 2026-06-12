// ---------------------------------------------------------------------------
// Mesh transport — send planning (the safety matrix)
//
// Pure decision logic for what a mesh send is allowed to do. Every row is
// deterministic; there is no path where the sender is left unsure whether a
// P2PK lock is safe:
//
//   | Receiver state              | Sender   | Plan                          |
//   |-----------------------------|----------|-------------------------------|
//   | creq with nut10             | online   | locked — no consent needed    |
//   | creq without nut10          | offline  | bearer DM — consent required  |
//   | mint overlap empty          | any      | abort (named mints)           |
//   | capable, solicit timeout    | any      | abort (UI may offer vanilla)  |
//   | no beacon (vanilla peer)    | any      | public broadcast — strong     |
//   |                             |          | consent or abort              |
//
// Mismatches between what the solicit asked for and what the creq carries
// (lock missing when online, lock present when offline, non-P2PK condition)
// are aborts — never silent downgrades.
// ---------------------------------------------------------------------------

import { decodePaymentRequest } from '@cashu/cashu-ts';
import type { MeshPeerCapabilities, ParsedMeshPaymentRequest } from './types';

const P2PK_LOCK_PUBKEY_PATTERN = /^02[0-9a-f]{64}$/i;

/** Trailing-slash + case differences must not break mint-allowlist matching. */
export function normalizeMintUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

export type ParseMeshPaymentRequestResult =
  | { ok: true; request: ParsedMeshPaymentRequest }
  | { ok: false; reason: 'invalid' | 'missing-id' | 'unsupported-lock' };

/**
 * Parse a serialized NUT-18 request into the fields the mesh flow plans
 * against. A `nut10` carrying anything other than a well-formed single P2PK
 * key is `unsupported-lock` — we cannot verify we'd satisfy the condition,
 * so the send must abort rather than guess.
 */
export function parseMeshPaymentRequest(creq: string): ParseMeshPaymentRequestResult {
  let decoded: ReturnType<typeof decodePaymentRequest>;
  try {
    decoded = decodePaymentRequest(creq.trim());
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  // The id correlates the payment payload and its statuses — without it the
  // receiver cannot match our payment to the request it issued.
  const paymentId = decoded.id?.trim();
  if (!paymentId) return { ok: false, reason: 'missing-id' };

  let lockPubkey: string | null = null;
  if (decoded.nut10) {
    if (decoded.nut10.kind !== 'P2PK' || !P2PK_LOCK_PUBKEY_PATTERN.test(decoded.nut10.data)) {
      return { ok: false, reason: 'unsupported-lock' };
    }
    lockPubkey = decoded.nut10.data.toLowerCase();
  }

  return {
    ok: true,
    request: {
      paymentId,
      unit: decoded.unit ?? 'sat',
      mintUrls: (decoded.mints ?? []).map(normalizeMintUrl),
      lockPubkey,
      amount: typeof decoded.amount === 'number' ? decoded.amount : undefined,
      singleUse: decoded.singleUse === true,
      creq: creq.trim(),
    },
  };
}

export type MeshSolicitOutcome =
  | { outcome: 'request'; request: ParsedMeshPaymentRequest }
  | { outcome: 'timeout' }
  | { outcome: 'invalid-request'; reason: 'invalid' | 'missing-id' | 'unsupported-lock' };

export type MeshSendAbortReason =
  /** Capable peer never answered (or answered garbage) — receiver unconfirmed. */
  | 'solicit-timeout'
  /** Receiver's creq was undecodable / unusable. */
  | 'invalid-request'
  /** The creq demands a spending condition we cannot verify we'd satisfy. */
  | 'unsupported-lock'
  /** Online send but the creq carries no P2PK lock — locking is not safe. */
  | 'missing-lock'
  /** Offline (bearer) send but the creq demands a lock we cannot apply offline. */
  | 'unexpected-lock'
  /** Receiver's trusted mints and our spendable mints do not intersect. */
  | 'no-mint-overlap';

export type MeshSendPlan =
  | {
      mode: 'locked';
      /** "02" + x-only hex — byte-exact target for the P2PK lock. */
      lockPubkey: string;
      paymentId: string;
      unit: string;
      /** Mints the send may draw from (creq allowlist ∩ our spendable mints). */
      allowedMintUrls: string[];
      creq: string;
      /** Locked to the receiver's fresh key — safe without user consent. */
      consent: 'none';
    }
  | {
      mode: 'bearer-dm';
      paymentId: string;
      unit: string;
      allowedMintUrls: string[];
      creq: string;
      /** Bearer proofs over a DM — requires an explicit consent step. */
      consent: 'bearer';
    }
  | {
      /** No beacon: public-broadcast bearer behind strong consent, or abort. */
      mode: 'vanilla-broadcast';
      consent: 'public-broadcast';
    }
  | {
      mode: 'abort';
      reason: MeshSendAbortReason;
      /** Populated for `no-mint-overlap` so the abort can name both sides. */
      theirMintUrls?: string[];
      ourMintUrls?: string[];
    };

export interface PlanMeshSendInput {
  /** From the peer's announce beacon; null = vanilla peer. */
  capabilities: MeshPeerCapabilities | null;
  /** True when the sender chose an offline (bearer-from-local-proofs) send. */
  senderOffline: boolean;
  /** Result of the solicit exchange. Ignored for vanilla peers. */
  solicit: MeshSolicitOutcome;
  /** Mints where we hold spendable balance (any casing/trailing slash). */
  localMintUrls: string[];
}

export function planMeshSend(input: PlanMeshSendInput): MeshSendPlan {
  if (!input.capabilities?.supportsNutRequests) {
    return { mode: 'vanilla-broadcast', consent: 'public-broadcast' };
  }

  if (input.solicit.outcome === 'timeout') {
    return { mode: 'abort', reason: 'solicit-timeout' };
  }
  if (input.solicit.outcome === 'invalid-request') {
    return {
      mode: 'abort',
      reason: input.solicit.reason === 'unsupported-lock' ? 'unsupported-lock' : 'invalid-request',
    };
  }

  const request = input.solicit.request;
  const ourMintUrls = input.localMintUrls.map(normalizeMintUrl);
  // NUT-18: an absent/empty `m` means the receiver accepts any mint.
  const allowedMintUrls =
    request.mintUrls.length === 0
      ? ourMintUrls
      : ourMintUrls.filter((url) => request.mintUrls.includes(url));

  if (allowedMintUrls.length === 0) {
    return {
      mode: 'abort',
      reason: 'no-mint-overlap',
      theirMintUrls: request.mintUrls,
      ourMintUrls,
    };
  }

  if (input.senderOffline) {
    if (request.lockPubkey) {
      // We flagged offline; a lock demand cannot be satisfied from existing
      // local proofs. Protocol mismatch — abort, never strip the lock.
      return { mode: 'abort', reason: 'unexpected-lock' };
    }
    return {
      mode: 'bearer-dm',
      paymentId: request.paymentId,
      unit: request.unit,
      allowedMintUrls,
      creq: request.creq,
      consent: 'bearer',
    };
  }

  if (!request.lockPubkey) {
    // Online send with no lock on offer: sending would mean unsolicited
    // bearer proofs. The sender must never be unsure a lock is safe — abort.
    return { mode: 'abort', reason: 'missing-lock' };
  }

  return {
    mode: 'locked',
    lockPubkey: request.lockPubkey,
    paymentId: request.paymentId,
    unit: request.unit,
    allowedMintUrls,
    creq: request.creq,
    consent: 'none',
  };
}
