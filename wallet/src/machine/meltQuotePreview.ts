// ---------------------------------------------------------------------------
// Melt quote preview (BTC-05 quote-first) — validity matching
//
// The machine creates the melt quote BEFORE the preview screen renders so
// the confirm sheet shows the mint's real fee_reserve and the amount+fee
// total. The quote is only valid for the exact inputs it was created
// against; any drift (mint change, amount edit, unit switch, new target)
// must create a fresh quote rather than charge against a stale one.
// ---------------------------------------------------------------------------

import type { MeltQuotePreview } from "./types";

/** True when `quote` was created for exactly these preview inputs. */
export function meltQuotePreviewMatches(
  quote: MeltQuotePreview | undefined,
  fields: { mintUrl: string; meltTarget: string; amount: number; unit: string },
): quote is MeltQuotePreview {
  return (
    !!quote &&
    quote.mintUrl === fields.mintUrl &&
    quote.meltTarget === fields.meltTarget &&
    quote.flowAmount === fields.amount &&
    quote.unit === fields.unit
  );
}
