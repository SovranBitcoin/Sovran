// ---------------------------------------------------------------------------
// Reusable mint-quote singleton (bolt12 offers / standing onchain addresses)
// ---------------------------------------------------------------------------
//
// coco v2's reusable mint quotes (bolt12, onchain) accept multiple payments
// per quote, but coco does NOT enforce any per-mint cardinality — every
// `quotes.mint.create()` mints a fresh offer/address, reusable quotes never
// leave `listPending`, and a fixed-amount onchain receive quote is
// shape-identical to a standing one. The ONLY reliable way to pin the
// receive-hub tabs to one stable quote is to record its identity: the app
// supplies a persisted `identityStore` keyed by (mintUrl, method, unit), we
// resolve the recorded quote by identity, and we only create (and re-record)
// when there is no live recorded quote. Fixed-amount requests, which create
// their own fresh quotes for payment attribution, can therefore never
// displace the standing QR.
//
// Get-or-create idempotency is payment-sequencing policy, so it lives in
// colada — apps only render the resulting quote and persist the identity map.

import { normalizeMintUrl } from "@cashu/coco-core";
import type { Manager } from "@cashu/coco-core";

import { logger, mintUrlFields } from "../logger";

export interface ReusableQuoteIdentityStore {
  get(key: string): string | undefined;
  set(key: string, quoteId: string): void;
  /**
   * Optional: notify when the recorded quote id for `key` changes from
   * OUTSIDE the caller — e.g. a deposit-triggered rotation done by a global
   * listener while the tab is mounted. Returns an unsubscribe function.
   */
  subscribe?(key: string, callback: () => void): () => void;
}

export interface EnsureReusableMintQuoteInput {
  mintUrl: string;
  method: "bolt12" | "onchain";
  unit: string;
}

type ReusableMintQuote = Awaited<
  ReturnType<Manager["quotes"]["mint"]["create"]>
>;

export function reusableQuoteKey(input: EnsureReusableMintQuoteInput): string {
  // Normalize with coco's own rules: the same mint reached via different URL
  // spellings (trailing slash, casing) must map to ONE standing quote, or
  // every caller variant records its own and the QR rotates between them.
  return `${normalizeMintUrl(input.mintUrl)}|${input.method}|${input.unit.trim().toLowerCase()}`;
}

function isUnexpired(expiry: number | null, nowSeconds: number): boolean {
  // Null = the mint issued a quote that never expires. Some mints send 0
  // with the same meaning for reusable offers (observed in the field:
  // bolt12 quotes with expiry 0) — treating 0 as a 1970 timestamp made the
  // standing offer "eternally expired" and rotated the QR on every open.
  // NOTE: coco's own isMintQuoteExpired treats 0 as expired too — flagged
  // for upstream via the zero_expiry warn below.
  return expiry === null || expiry <= 0 || expiry > nowSeconds;
}

/**
 * Resolve the recorded standing quote for (mint, method, unit), creating and
 * recording one only when none is recorded or the recorded one expired.
 * Never rotates a live standing quote.
 */
// One in-flight ensure per key: a double-mounted tab (React StrictMode,
// rapid re-open) must never race two creates for the same standing quote.
const inFlight = new Map<string, Promise<ReusableMintQuote>>();

export async function ensureReusableMintQuote(
  manager: Manager,
  input: EnsureReusableMintQuoteInput,
  identityStore: ReusableQuoteIdentityStore,
): Promise<ReusableMintQuote> {
  const key = reusableQuoteKey(input);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const task = resolveReusableMintQuote(manager, input, identityStore, key);
  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Force-rotate the standing quote for (mint, method, unit): create a fresh
 * quote and record it, retiring the current one. Address-reuse policy for the
 * ONCHAIN rail — after a deposit lands on the standing address (or the user
 * asks for a new one), the next payer should get a fresh address. The old
 * quote stays pending in coco (reusable quotes never close), so late payments
 * to the old address still auto-mint. Bolt12 offers deliberately do NOT
 * rotate — one stable offer per mint is the product contract.
 */
export async function rotateReusableMintQuote(
  manager: Manager,
  input: EnsureReusableMintQuoteInput,
  identityStore: ReusableQuoteIdentityStore,
  reason: "deposit_received" | "manual",
): Promise<ReusableMintQuote> {
  const key = reusableQuoteKey(input);
  // Let any in-flight ensure settle first so its callers keep a consistent
  // quote, then rotate — the rotation task owns the slot afterwards.
  const pending = inFlight.get(key);
  if (pending) await pending.catch(() => undefined);

  const unit = input.unit.trim().toLowerCase();
  const task = (async () => {
    const created = await manager.quotes.mint.create({
      mintUrl: input.mintUrl,
      method: input.method,
      unit,
    });
    identityStore.set(key, created.quoteId);
    logger.info("quotes.reusable.rotated", {
      ...mintUrlFields(input.mintUrl),
      method: input.method,
      unit,
      reason,
      requestLength: created.request.length,
    });
    return created;
  })();
  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}

async function resolveReusableMintQuote(
  manager: Manager,
  input: EnsureReusableMintQuoteInput,
  identityStore: ReusableQuoteIdentityStore,
  key: string,
): Promise<ReusableMintQuote> {
  const { mintUrl, method } = input;
  const unit = input.unit.trim().toLowerCase();
  const nowSeconds = Math.floor(Date.now() / 1000);

  const recordedId = identityStore.get(key);
  // Why a create happened is the exact detail needed to debug "the QR keeps
  // rotating" reports — name the reason instead of a boolean.
  let createReason:
    | "no_recorded_quote"
    | "recorded_not_found"
    | "lookup_failed"
    | "method_mismatch"
    | "unit_mismatch"
    | "not_reusable"
    | "expired" = "no_recorded_quote";

  if (recordedId) {
    let recorded: ReusableMintQuote | null = null;
    try {
      recorded = await manager.quotes.mint.get({
        mintUrl,
        quoteId: recordedId,
      });
      createReason = recorded === null ? "recorded_not_found" : createReason;
    } catch (error) {
      createReason = "lookup_failed";
      logger.warn("quotes.reusable.lookup_failed", {
        ...mintUrlFields(mintUrl),
        method,
        unit,
        error:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
      });
    }
    if (recorded) {
      if (recorded.method !== method) createReason = "method_mismatch";
      else if (recorded.unit !== unit) createReason = "unit_mismatch";
      else if (!recorded.reusable) createReason = "not_reusable";
      else if (!isUnexpired(recorded.expiry, nowSeconds))
        createReason = "expired";
      else {
        if (recorded.expiry === 0) {
          // Upstream-relevant: mint sent expiry 0 for a reusable quote; coco
          // core's expiry checks treat 0 as already-expired, which may stop
          // its watcher from tracking this quote.
          logger.warn("quotes.reusable.zero_expiry", {
            ...mintUrlFields(mintUrl),
            method,
            unit,
          });
        }
        logger.info("quotes.reusable.reused", {
          ...mintUrlFields(mintUrl),
          method,
          unit,
          quoteAgeMs: Date.now() - recorded.createdAt,
          expiresInS:
            recorded.expiry === null ? null : recorded.expiry - nowSeconds,
        });
        return recorded;
      }
      logger.warn("quotes.reusable.recorded_discarded", {
        ...mintUrlFields(mintUrl),
        method,
        unit,
        reason: createReason,
        recordedMethod: recorded.method,
        recordedUnit: recorded.unit,
        recordedExpiry: recorded.expiry,
        nowSeconds,
      });
    }
  }

  const created = await manager.quotes.mint.create({ mintUrl, method, unit });
  identityStore.set(key, created.quoteId);
  logger.info("quotes.reusable.created", {
    ...mintUrlFields(mintUrl),
    method,
    unit,
    reason: createReason,
    requestLength: created.request.length,
  });
  return created;
}
