// ---------------------------------------------------------------------------
// Reusable mint-quote singleton (bolt12 offers / standing onchain addresses)
// ---------------------------------------------------------------------------
//
// coco v2's reusable mint quotes (bolt12, onchain) accept multiple payments
// per quote, but coco does NOT enforce any per-mint cardinality — every
// `quotes.mint.create()` mints a fresh offer/address. The product contract
// is ONE standing offer/address per (mint, method, unit): the receive-hub
// tabs reuse the open quote so the QR stays stable and payment attribution
// stays unambiguous, while the fixed-amount flow deliberately bypasses this
// module to get a fresh address per request.
//
// Get-or-create idempotency is payment-sequencing policy, so it lives in
// colada — apps only render the resulting quote.

import type { Manager } from "@cashu/coco-core";

import { logger, mintUrlFields } from "../logger";

export interface EnsureReusableMintQuoteInput {
  mintUrl: string;
  method: "bolt12" | "onchain";
  unit: string;
}

type ReusableMintQuote = Awaited<
  ReturnType<Manager["quotes"]["mint"]["create"]>
>;

function isUnexpired(expiry: number | null, nowSeconds: number): boolean {
  // Null expiry = the mint issued a quote that never expires.
  return expiry === null || expiry > nowSeconds;
}

/**
 * Return the newest open reusable quote for (mint, method, unit), creating
 * one only when none exists. Never rotates an existing open quote.
 */
export async function ensureReusableMintQuote(
  manager: Manager,
  input: EnsureReusableMintQuoteInput,
): Promise<ReusableMintQuote> {
  const { mintUrl, method } = input;
  const unit = input.unit.trim().toLowerCase();
  const nowSeconds = Math.floor(Date.now() / 1000);

  const pending = await manager.quotes.mint.listPending({ method });
  const candidates = pending
    .filter(
      (quote) =>
        quote.mintUrl === mintUrl &&
        quote.unit === unit &&
        quote.reusable &&
        isUnexpired(quote.expiry, nowSeconds),
    )
    .sort((a, b) => b.createdAt - a.createdAt);

  const existing = candidates[0];
  if (existing) {
    logger.info("quotes.reusable.reused", {
      ...mintUrlFields(mintUrl),
      method,
      unit,
      pendingCount: candidates.length,
      quoteAgeMs: Date.now() - existing.createdAt,
      expiresInS:
        existing.expiry === null ? null : existing.expiry - nowSeconds,
    });
    return existing;
  }

  const expiredDiscarded = pending.filter(
    (quote) =>
      quote.mintUrl === mintUrl &&
      quote.unit === unit &&
      !isUnexpired(quote.expiry, nowSeconds),
  ).length;
  if (expiredDiscarded > 0) {
    logger.info("quotes.reusable.expired_discarded", {
      ...mintUrlFields(mintUrl),
      method,
      unit,
      count: expiredDiscarded,
    });
  }

  const created = await manager.quotes.mint.create(
    method === "bolt12" ? { mintUrl, method, unit } : { mintUrl, method, unit },
  );
  logger.info("quotes.reusable.created", {
    ...mintUrlFields(mintUrl),
    method,
    unit,
    requestLength: created.request.length,
  });
  return created;
}
