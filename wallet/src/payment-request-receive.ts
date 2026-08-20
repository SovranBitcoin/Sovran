// ---------------------------------------------------------------------------
// Standing NUT-18 payment request (the receive hub's "Cashu" rail)
// ---------------------------------------------------------------------------
//
// coco v2 owns the durable receive pipeline (PaymentRequestReceiveOperation:
// active → completed/cancelled, claim attempts, dedupe, crash recovery) but
// enforces a positive amount on create — NUT-18 itself makes the amount
// OPTIONAL, so an "address-like" standing request needs two workarounds,
// both flagged upstream:
//
//   1. The durable operation is created with a 1-unit floor amount
//      (singleUse: false). coco's claim validation only requires the payload
//      to be >= the operation amount, so any real payment clears the floor.
//   2. The DISPLAYED encoding is re-encoded WITHOUT the amount (same request
//      id, transport, mints, unit), so payer wallets prompt for an amount
//      instead of pre-filling "1".
//
// Like the reusable-quote rails, get-or-create/rotate idempotency lives here
// in colada; the app persists the operation identity per unit and renders.

import { PaymentRequest, decodePaymentRequest } from "@cashu/cashu-ts";
import type { Manager } from "@cashu/coco-core";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

import { logger } from "./logger";
import type { ReusableQuoteIdentityStore } from "./quotes/reusable";

export interface StandingPaymentRequestInput {
  unit: string;
  /** Mint allow-list embedded in the request. Should be the wallet's trusted
   *  mints — coco rejects payloads from untrusted mints, so advertising
   *  anything else strands the payer's ecash in a DM. */
  mints: string[];
  /**
   * Optional NUT-10 P2PK lock advertised in the DISPLAYED encoding (payers
   * lock proofs to this 02-prefixed key). coco's create() still rejects
   * nut10 input, so the durable op stays lock-free — but its claim path
   * signs P2PK proofs transparently (ProofService.prepareProofsForReceiving
   * → KeyRingService.signProof), PROVIDED this exact pubkey is persisted in
   * the keyring under purpose 'p2pk' (exact lookup, no fallback).
   */
  lockP2pkPubkey?: string;
  /**
   * Optional narrowed mint list for the DISPLAYED encoding (user toggles /
   * P2PK capability filtering). Applied as an intersection with the durable
   * op's own mint list, so the display can only ever advertise a subset —
   * the op keeps the FULL trusted list, and a payment from a de-advertised
   * (still trusted) mint still claims. Like the lock, changing this only
   * re-encodes; it never rotates the operation.
   */
  displayMints?: string[];
}

export interface StandingPaymentRequest {
  /** coco operation id (the durable receive op, state 'active'). */
  operationId: string;
  /** NUT-18 request id payloads are routed by. */
  requestId?: string;
  /** Amountless encoding for display/QR (coco's own encodedRequest carries
   *  the 1-unit floor workaround). */
  encodedRequest: string;
  /** Same amountless request in bech32m creqB — the encoding NUT-26's
   *  BIP-321 integration expects for the `creq` URI key. */
  encodedRequestB: string;
  mints: string[];
  unit: string;
}

export function standingPaymentRequestKey(unit: string): string {
  return `creq|${unit.trim().toLowerCase()}`;
}

function generateRequestId(): string {
  return `sov${bytesToHex(randomBytes(16))}`;
}

/**
 * Narrow a request's advertised mint list to a display subset (intersection).
 * An empty intersection would advertise "any mint" (m is optional in NUT-18) —
 * worse than the un-narrowed list — so it falls back to the original list.
 */
function narrowDisplayMints(
  mints: string[] | undefined,
  displayMints: string[] | undefined,
): string[] | undefined {
  if (!displayMints || displayMints.length === 0) return mints;
  if (!mints || mints.length === 0) return mints;
  const allowed = new Set(displayMints);
  const narrowed = mints.filter((m) => allowed.has(m));
  if (narrowed.length > 0) return narrowed;
  logger.warn("creq.display_mints_empty_intersection", {
    opMintCount: mints.length,
    displayMintCount: displayMints.length,
  });
  return mints;
}

/** Encode a PaymentRequest to both creqA and (best-effort) creqB. */
function encodeDisplay(display: PaymentRequest): {
  encodedRequest: string;
  encodedRequestB: string;
} {
  const encodedA = display.toEncodedRequest();
  let encodedB = encodedA;
  try {
    // creqB TLV-encodes the transport target (validates the nprofile);
    // NUT-18 accepts creqA everywhere, so fall back to it if B encoding
    // rejects the transport.
    encodedB = display.toEncodedCreqB();
  } catch (error) {
    logger.warn("creq.creqb_encode_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { encodedRequest: encodedA, encodedRequestB: encodedB };
}

/** Re-encode coco's request without the floor amount (and optionally WITH a
 *  NUT-10 P2PK lock and/or a narrowed mint list) for display. */
function toAmountlessEncodings(
  encodedRequest: string,
  lockP2pkPubkey?: string,
  displayMints?: string[],
): {
  encodedRequest: string;
  encodedRequestB: string;
} {
  const decoded = decodePaymentRequest(encodedRequest);
  const display = new PaymentRequest(
    decoded.transport,
    decoded.id,
    undefined, // amount — the whole point
    decoded.unit,
    narrowDisplayMints(decoded.mints, displayMints),
    decoded.description,
    false, // singleUse
    lockP2pkPubkey
      ? { kind: "P2PK", data: lockP2pkPubkey, tags: [] }
      : undefined,
  );
  return encodeDisplay(display);
}

export interface SingleUseReencodeOptions {
  /**
   * NUT-10 P2PK lock to advertise in the DISPLAYED encoding. coco's create()
   * rejects nut10 input, so the durable single-use op stays lock-free — but its
   * claim path signs P2PK proofs transparently PROVIDED this exact 02-prefixed
   * pubkey is persisted in the keyring under purpose 'p2pk' (exact lookup).
   */
  lockP2pkPubkey?: string;
  /**
   * Narrowed mint list for display (intersected with the op's list, so the QR
   * can only ever advertise a subset; the durable op keeps the FULL list so a
   * payment from a de-advertised-but-trusted mint still claims).
   */
  displayMints?: string[];
}

/**
 * Re-encode a SINGLE-USE incoming request ("as Ecash") for display, KEEPING its
 * amount and `singleUse` flag (unlike the amountless standing rail) while
 * optionally narrowing the advertised mints and attaching a NUT-10 P2PK lock.
 * Pure — the durable coco op is untouched; only the displayed creq changes.
 */
export function reencodeSingleUsePaymentRequest(
  encodedRequest: string,
  options: SingleUseReencodeOptions = {},
): { encodedRequest: string; encodedRequestB: string } {
  const decoded = decodePaymentRequest(encodedRequest);
  const display = new PaymentRequest(
    decoded.transport,
    decoded.id,
    decoded.amount, // KEEP the requested amount
    decoded.unit,
    narrowDisplayMints(decoded.mints, options.displayMints),
    decoded.description,
    decoded.singleUse, // KEEP single-use
    options.lockP2pkPubkey
      ? { kind: "P2PK", data: options.lockP2pkPubkey, tags: [] }
      : undefined,
  );
  return encodeDisplay(display);
}

type IncomingOp = Awaited<
  ReturnType<Manager["paymentRequests"]["incoming"]["create"]>
>;

function toStanding(
  operation: IncomingOp,
  input: Pick<StandingPaymentRequestInput, "lockP2pkPubkey" | "displayMints">,
): StandingPaymentRequest {
  return {
    operationId: operation.id,
    requestId: operation.requestId,
    ...toAmountlessEncodings(
      operation.encodedRequest,
      input.lockP2pkPubkey,
      input.displayMints,
    ),
    mints: operation.mints,
    unit: operation.unit,
  };
}

async function createStanding(
  manager: Manager,
  input: StandingPaymentRequestInput,
  identityStore: ReusableQuoteIdentityStore,
  key: string,
  reason: string,
): Promise<StandingPaymentRequest> {
  const operation = await manager.paymentRequests.incoming.create({
    // coco requires a positive amount (upstream: NUT-18 allows amountless);
    // 1 is a floor — claim validation accepts any payload >= it.
    amount: 1,
    unit: input.unit,
    mints: input.mints,
    requestId: generateRequestId(),
    singleUse: false,
    transport: "nostr",
  });
  identityStore.set(key, operation.id);
  logger.info("creq.standing.created", {
    reason,
    unit: operation.unit,
    mintCount: operation.mints.length,
    displayMintCount: input.displayMints?.length ?? null,
    encodedLength: operation.encodedRequest.length,
    hasP2pkLock: !!input.lockP2pkPubkey,
  });
  return toStanding(operation, input);
}

const inFlight = new Map<string, Promise<StandingPaymentRequest>>();

// Last resolved standing request per key+lock, PER MANAGER (WeakMap — see
// quotes/reusable.ts). Seeds synchronous renders on re-mount.
const resolvedCache = new WeakMap<
  Manager,
  Map<string, StandingPaymentRequest>
>();

function cacheFor(manager: Manager): Map<string, StandingPaymentRequest> {
  let map = resolvedCache.get(manager);
  if (!map) {
    map = new Map();
    resolvedCache.set(manager, map);
  }
  return map;
}

function cacheKey(input: StandingPaymentRequestInput): string {
  return `${standingPaymentRequestKey(input.unit)}|${input.lockP2pkPubkey ?? ""}|${input.displayMints?.join(",") ?? ""}`;
}

/** Synchronous read of the last resolved standing request (per lock state)
 *  — render-from-cache seed; callers still revalidate asynchronously. */
export function peekStandingPaymentRequest(
  manager: Manager,
  input: StandingPaymentRequestInput,
): StandingPaymentRequest | null {
  return cacheFor(manager).get(cacheKey(input)) ?? null;
}

/**
 * Resolve the recorded standing payment request for the unit, creating and
 * recording one only when none is recorded or the recorded one is no longer
 * an active reusable operation for this unit.
 */
export async function ensureStandingPaymentRequest(
  manager: Manager,
  input: StandingPaymentRequestInput,
  identityStore: ReusableQuoteIdentityStore,
): Promise<StandingPaymentRequest> {
  const key = standingPaymentRequestKey(input.unit);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const startedAt = Date.now();
  const task = (async () => {
    const recordedId = identityStore.get(key);
    let reason = "no_recorded_request";
    if (recordedId) {
      const operation = await manager.paymentRequests.incoming
        .get(recordedId)
        .catch(() => null);
      if (
        operation &&
        operation.state === "active" &&
        !operation.singleUse &&
        operation.unit === input.unit.trim().toLowerCase()
      ) {
        // Mint list drift (mints trusted/untrusted since creation) is
        // tolerated: the QR advertises the creation-time list; a rotation
        // refreshes it.
        logger.info("creq.standing.reused", {
          unit: operation.unit,
          mintCount: operation.mints.length,
          displayMintCount: input.displayMints?.length ?? null,
          hasP2pkLock: !!input.lockP2pkPubkey,
        });
        return toStanding(operation, input);
      }
      reason = !operation
        ? "recorded_not_found"
        : operation.state !== "active"
          ? `recorded_${operation.state}`
          : operation.singleUse
            ? "recorded_single_use"
            : "unit_mismatch";
      logger.warn("creq.standing.recorded_discarded", { reason });
    }
    return createStanding(manager, input, identityStore, key, reason);
  })().then((resolved) => {
    cacheFor(manager).set(cacheKey(input), resolved);
    logger.info("creq.standing.resolve_timing", {
      duration_ms: Date.now() - startedAt,
    });
    return resolved;
  });

  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Retire the standing request (cancel the durable op — its transport
 * deactivates) and record a fresh one with a NEW request id. The Cashu
 * rail's "new request" affordance; also self-heals a stale mint list.
 */
export async function rotateStandingPaymentRequest(
  manager: Manager,
  input: StandingPaymentRequestInput,
  identityStore: ReusableQuoteIdentityStore,
): Promise<StandingPaymentRequest> {
  const key = standingPaymentRequestKey(input.unit);
  const pending = inFlight.get(key);
  if (pending) await pending.catch(() => undefined);

  const task = (async () => {
    const recordedId = identityStore.get(key);
    if (recordedId) {
      try {
        await manager.paymentRequests.incoming.cancel(recordedId, "rotated");
      } catch (error) {
        // Already terminal / unknown — nothing to retire.
        logger.debug("creq.standing.cancel_skipped", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return createStanding(manager, input, identityStore, key, "rotated");
  })().then((resolved) => {
    cacheFor(manager).set(cacheKey(input), resolved);
    return resolved;
  });

  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}
