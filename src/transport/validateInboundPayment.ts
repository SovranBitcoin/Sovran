// ---------------------------------------------------------------------------
// Mesh transport — inbound payment validation (receiver side)
//
// A mesh payment payload is accepted only when it claims a request WE issued
// and matches it exactly: known id, single-use not yet claimed, mint inside
// the request's allowlist, unit match, and the proofs locked to exactly the
// key the request demanded (or bearer iff the request was bearer). Anything
// else is rejected with the wire-level reason the 0xA3 status carries.
// ---------------------------------------------------------------------------

import { getEncodedToken, type Proof } from '@cashu/cashu-ts';
import { classifyMeshToken } from './classify';
import { normalizeMintUrl } from './plan';
import type { IssuedMeshRequest, MeshRequestResponder } from './requestResponder';
import type { MeshRejectReason } from './types';

export interface AcceptedMeshPayment {
  paymentId: string;
  request: IssuedMeshRequest;
  /** Encoded cashu token (proofs re-wrapped) — feed to the redeem queue. */
  token: string;
  mintUrl: string;
  unit: string;
  /** Sum of proof amounts (mint units). */
  amount: number;
}

export type ValidateInboundMeshPaymentResult =
  | { ok: true; payment: AcceptedMeshPayment }
  | { ok: false; reason: Exclude<MeshRejectReason, 'unknown'>; paymentId: string | null };

interface RawPaymentPayload {
  id?: unknown;
  mint?: unknown;
  unit?: unknown;
  proofs?: unknown;
}

function isProofLike(value: unknown): value is Proof {
  if (typeof value !== 'object' || value === null) return false;
  const proof = value as Record<string, unknown>;
  return (
    typeof proof.amount === 'number' &&
    typeof proof.secret === 'string' &&
    typeof proof.C === 'string' &&
    typeof proof.id === 'string'
  );
}

/**
 * Validate a raw NUT-18 PaymentRequestPayload JSON against the requests this
 * responder issued. `fromPeerId` enforces the request's peer binding — a
 * different peer replaying our payment id must not burn the single-use
 * request. Claims the request only when every check passes — a rejected
 * payment leaves it open for a retry.
 */
export function validateInboundMeshPayment(
  payloadJson: string,
  responder: MeshRequestResponder,
  fromPeerId: string
): ValidateInboundMeshPaymentResult {
  let raw: RawPaymentPayload;
  try {
    raw = JSON.parse(payloadJson) as RawPaymentPayload;
  } catch {
    return { ok: false, reason: 'invalid', paymentId: null };
  }

  const paymentId = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null;
  if (!paymentId) return { ok: false, reason: 'invalid', paymentId: null };

  const issued = responder.peek(paymentId);
  if (!issued) {
    // An id we never issued (or one that already expired) — to the sender
    // both are "this doesn't match an outstanding request".
    return { ok: false, reason: 'mismatch', paymentId };
  }
  if (issued.consumed) {
    return { ok: false, reason: 'duplicate', paymentId };
  }
  if (issued.peerId !== fromPeerId) {
    // The request was issued to a specific peer over its Noise session; a
    // matching id from anyone else is foreign/replayed content.
    return { ok: false, reason: 'mismatch', paymentId };
  }

  if (
    typeof raw.mint !== 'string' ||
    raw.mint.length === 0 ||
    !Array.isArray(raw.proofs) ||
    raw.proofs.length === 0 ||
    !raw.proofs.every(isProofLike)
  ) {
    return { ok: false, reason: 'invalid', paymentId };
  }
  const mintUrl = raw.mint;
  const proofs = raw.proofs;

  const unit = typeof raw.unit === 'string' && raw.unit.length > 0 ? raw.unit : 'sat';
  if (unit !== issued.unit) {
    return { ok: false, reason: 'mismatch', paymentId };
  }

  // Mint must be inside the allowlist WE put in the request (empty = any) —
  // this is what stops a hostile sender parking value at a mint we'd never
  // trust before any wallet state is touched.
  if (
    issued.mintUrls.length > 0 &&
    !issued.mintUrls.includes(normalizeMintUrl(mintUrl))
  ) {
    return { ok: false, reason: 'untrustedMint', paymentId };
  }

  let token: string;
  try {
    token = getEncodedToken({ mint: mintUrl, proofs, unit });
  } catch {
    return { ok: false, reason: 'invalid', paymentId };
  }

  // Lock check is byte-exact against the request: locked request → every
  // proof single-sig P2PK to the issued key; bearer request → no locks at
  // all. Partial/multisig/foreign-key tokens are mismatches.
  const classified = classifyMeshToken(token, issued.lockPubkey ?? '');
  const lockSatisfied = issued.lockPubkey
    ? classified.classification === 'locked-to-me'
    : classified.classification === 'bearer';
  if (!lockSatisfied) {
    return { ok: false, reason: 'mismatch', paymentId };
  }

  const claimed = responder.consume(paymentId);
  if (!claimed) {
    // Raced another delivery of the same id between peek and consume.
    return { ok: false, reason: 'duplicate', paymentId };
  }

  return {
    ok: true,
    payment: {
      paymentId,
      request: claimed,
      token,
      mintUrl,
      unit,
      amount: classified.amount,
    },
  };
}
