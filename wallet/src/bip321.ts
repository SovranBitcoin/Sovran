// ---------------------------------------------------------------------------
// BIP-321 helpers
// ---------------------------------------------------------------------------

import { logger } from "./logger";

const SATS_PER_BTC = 100_000_000;

export interface BuildBip321OnchainUriOptions {
  amountSats?: number | null;
  label?: string | null;
  message?: string | null;
}

export function formatSatsAsBtcAmount(amountSats: number): string | null {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    logger.warn("bip321.amount.invalid", {
      amountSats,
      safeInteger: Number.isSafeInteger(amountSats),
      positive: amountSats > 0,
    });
    return null;
  }

  const whole = Math.floor(amountSats / SATS_PER_BTC);
  const fractional = amountSats % SATS_PER_BTC;
  if (fractional === 0) {
    const formatted = String(whole);
    logger.debug("bip321.amount.formatted", {
      amountSats,
      hasFractional: false,
      outputLength: formatted.length,
    });
    return formatted;
  }

  const formatted = `${whole}.${String(fractional).padStart(8, "0").replace(/0+$/, "")}`;
  logger.debug("bip321.amount.formatted", {
    amountSats,
    hasFractional: true,
    outputLength: formatted.length,
  });
  return formatted;
}

export function buildBip321OnchainUri(
  address: string,
  options: BuildBip321OnchainUriOptions = {},
): string {
  const trimmedAddress = address.trim();
  logger.info("bip321.uri.build.start", {
    addressLength: trimmedAddress.length,
    hasAmountSats: typeof options.amountSats === "number",
    hasLabel: !!options.label?.trim(),
    hasMessage: !!options.message?.trim(),
  });
  const params = new URLSearchParams();
  const amountBtc =
    typeof options.amountSats === "number"
      ? formatSatsAsBtcAmount(options.amountSats)
      : null;

  if (amountBtc) params.set("amount", amountBtc);

  const label = options.label?.trim();
  if (label) params.set("label", label);

  const message = options.message?.trim();
  if (message) params.set("message", message);

  const query = params.toString().replace(/\+/g, "%20");
  const uri = query
    ? `bitcoin:${trimmedAddress}?${query}`
    : `bitcoin:${trimmedAddress}`;
  logger.info("bip321.uri.build.done", {
    addressLength: trimmedAddress.length,
    paramCount: Array.from(params.keys()).length,
    hasAmount: params.has("amount"),
    hasLabel: params.has("label"),
    hasMessage: params.has("message"),
    uriLength: uri.length,
  });
  return uri;
}

export interface BuildUnifiedBip321UriInput {
  /** Onchain address — the URI body (BIP-321 allows an empty body). */
  address?: string | null;
  /** BOLT11 invoice — the `lightning` key. NOTE: only invoices have a
   *  consensus key; lightning ADDRESSES (user@domain) have none — those are
   *  BIP-353 (DNS) territory, resolved TO a BIP-321 URI, never embedded. */
  lightning?: string | null;
  /** BOLT12 offer — the `lno` key. */
  lno?: string | null;
  /** NUT-26 cashu payment request — the `creq` key (bech32m creqB per the
   *  NUT-26 "BIP-321 Integration" section). */
  creq?: string | null;
}

/**
 * One QR for every rail: compose the standing onchain address, BOLT12 offer
 * and cashu payment request into a single BIP-321 URI. Wallets use the best
 * method they support and fall back across keys. Returns null when no
 * component is available.
 */
export function buildUnifiedBip321Uri(
  input: BuildUnifiedBip321UriInput,
): string | null {
  const address = input.address?.trim() ?? "";
  const params = new URLSearchParams();
  if (input.lightning?.trim()) params.set("lightning", input.lightning.trim());
  if (input.lno?.trim()) params.set("lno", input.lno.trim());
  if (input.creq?.trim()) params.set("creq", input.creq.trim());
  const query = params.toString();
  if (!address && !query) {
    logger.debug("bip321.unified.empty", {});
    return null;
  }
  const uri = query ? `bitcoin:${address}?${query}` : `bitcoin:${address}`;
  logger.info("bip321.unified.built", {
    hasAddress: !!address,
    hasLightning: !!input.lightning?.trim(),
    hasLno: !!input.lno?.trim(),
    hasCreq: !!input.creq?.trim(),
    uriLength: uri.length,
  });
  return uri;
}
