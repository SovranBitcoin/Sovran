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

import type { Manager } from "@cashu/coco-core";

import { logger, mintUrlFields } from "../logger";

export interface ReusableQuoteIdentityStore {
  get(key: string): string | undefined;
  set(key: string, quoteId: string): void;
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
  return `${input.mintUrl}|${input.method}|${input.unit.trim().toLowerCase()}`;
}

function isUnexpired(expiry: number | null, nowSeconds: number): boolean {
  // Null expiry = the mint issued a quote that never expires.
  return expiry === null || expiry > nowSeconds;
}

/**
 * Resolve the recorded standing quote for (mint, method, unit), creating and
 * recording one only when none is recorded or the recorded one expired.
 * Never rotates a live standing quote.
 */
export async function ensureReusableMintQuote(
  manager: Manager,
  input: EnsureReusableMintQuoteInput,
  identityStore: ReusableQuoteIdentityStore,
): Promise<ReusableMintQuote> {
  const { mintUrl, method } = input;
  const unit = input.unit.trim().toLowerCase();
  const key = reusableQuoteKey(input);
  const nowSeconds = Math.floor(Date.now() / 1000);

  const recordedId = identityStore.get(key);
  if (recordedId) {
    const recorded = await manager.quotes.mint
      .get({ mintUrl, quoteId: recordedId })
      .catch(() => null);
    if (
      recorded &&
      recorded.method === method &&
      recorded.unit === unit &&
      recorded.reusable &&
      isUnexpired(recorded.expiry, nowSeconds)
    ) {
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
    logger.info("quotes.reusable.expired_discarded", {
      ...mintUrlFields(mintUrl),
      method,
      unit,
      hadRecordedQuote: !!recorded,
    });
  }

  const created = await manager.quotes.mint.create({ mintUrl, method, unit });
  identityStore.set(key, created.quoteId);
  logger.info("quotes.reusable.created", {
    ...mintUrlFields(mintUrl),
    method,
    unit,
    requestLength: created.request.length,
  });
  return created;
}
