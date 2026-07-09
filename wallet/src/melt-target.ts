// ---------------------------------------------------------------------------
// Melt-target classification
//
// A concrete send target (scanned/pasted, then held on the flow ctx as
// `meltTarget`) has a FIXED melt method: an onchain address is paid onchain, a
// bolt12 offer via a bolt12 melt, and a bolt11 invoice / LNURL / lightning
// address all resolve to a bolt11 invoice. The amount-entry variant menu and
// its handler both need this so they never label a bc1 address "over Lightning"
// or try to pay it as bolt11.
// ---------------------------------------------------------------------------

import { defaultDetectors } from "./detectors";
import type { MeltQuoteMethod } from "./machine/types";
import { parsePaymentInput } from "./parse";

// The amount screen re-inspects on every keystroke, but the meltTarget doesn't
// change while typing — memoize the last classification so we parse once.
let lastTarget: string | null = null;
let lastMethod: MeltQuoteMethod | null = null;

/**
 * The melt method a concrete send target resolves to, or null when it isn't a
 * payable send target. onchain address → 'onchain'; bolt12 offer → 'bolt12';
 * bolt11 invoice / LNURL / lightning address → 'bolt11'.
 */
export function meltMethodForTarget(meltTarget: string): MeltQuoteMethod | null {
  const target = meltTarget.trim();
  if (!target) return null;
  if (target === lastTarget) return lastMethod;
  lastTarget = target;

  const parsed = parsePaymentInput(target, defaultDetectors);
  const kinds = new Set(parsed.options.map((option) => option.kind));
  lastMethod = kinds.has("bolt12Offer")
    ? "bolt12"
    : kinds.has("lightningInvoice") ||
        kinds.has("lightningAddress") ||
        kinds.has("lnurlp")
      ? "bolt11"
      : kinds.has("onchainAddress")
        ? "onchain"
        : null;
  return lastMethod;
}
