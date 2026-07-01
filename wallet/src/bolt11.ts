// ---------------------------------------------------------------------------
// Bolt11 lightning invoice decoding
//
// The single canonical place colada decodes a bolt11 invoice. `defaultDetectors`
// delegates here for the amount, and wallet apps import this instead of reaching
// for `@gandlaf21/bolt11-decode` directly (e.g. for invoice expiry math).
// ---------------------------------------------------------------------------

import { decode } from "@gandlaf21/bolt11-decode";

import { logger } from "./logger";

export interface Bolt11Info {
  /** Amount in sats, or null when the invoice is amountless. */
  amountSat: number | null;
  /** Invoice creation time (unix seconds), or null. */
  timestampSec: number | null;
  /** Relative expiry in seconds (the invoice's `expiry`), or null. */
  expirySec: number | null;
  /** Invoice description / memo, or null. */
  description: string | null;
  paymentHash: string | null;
}

const tryDecode = <T>(fn: () => T): T | null => {
  try {
    return fn();
  } catch {
    return null;
  }
};

const sectionValue = (
  sections: { name?: string; value?: unknown }[] | undefined,
  name: string,
): unknown => sections?.find((s) => s?.name === name)?.value;

/**
 * Decode a bolt11 invoice's fields (amount, timestamp, expiry, description,
 * payment hash). Pure and throw-safe — returns null for any non-invoice /
 * undecodable input.
 */
export function decodeBolt11Invoice(invoice: string): Bolt11Info | null {
  const decoded = tryDecode(() => decode(invoice));
  if (!decoded) {
    logger.debug("bolt11.decode.failed", { inputLength: invoice.length });
    return null;
  }
  const sections = decoded.sections as
    | { name?: string; value?: unknown }[]
    | undefined;

  // bolt11-decode surfaces the amount section `value` as msats — as a string in
  // some builds, a number in others — so coerce before dividing.
  const msatsRaw = sectionValue(sections, "amount");
  const msats =
    typeof msatsRaw === "string" ? Number(msatsRaw) : (msatsRaw as number);
  const amountSat =
    typeof msats === "number" && Number.isFinite(msats) && msats > 0
      ? msats / 1000
      : null;

  const timestamp = sectionValue(sections, "timestamp");
  const description = sectionValue(sections, "description");
  const paymentHash = sectionValue(sections, "payment_hash");

  const info: Bolt11Info = {
    amountSat,
    timestampSec: typeof timestamp === "number" ? timestamp : null,
    expirySec: typeof decoded.expiry === "number" ? decoded.expiry : null,
    description: typeof description === "string" ? description : null,
    paymentHash: typeof paymentHash === "string" ? paymentHash : null,
  };
  logger.debug("bolt11.decode.ok", {
    hasAmount: info.amountSat != null,
    hasExpiry: info.expirySec != null,
  });
  return info;
}
