// ---------------------------------------------------------------------------
// NFC Fallback
//
// When one payment option fails (e.g. NFC connection lost while sending a
// payment request), picks the next best option from the parsed input.
// Typical fallback: paymentRequest → lightningInvoice.
// ---------------------------------------------------------------------------

import type { ParsedPaymentInput, PaymentOption, PaymentOptionKind } from './types';

/**
 * Given a parsed input and the kind that failed, return the next best
 * option of a different kind (if one exists).
 */
export function getNfcFallback(
  parsed: ParsedPaymentInput,
  failedKind: PaymentOptionKind
): PaymentOption | null {
  return parsed.options.find((o) => o.kind !== failedKind) ?? null;
}

/**
 * Get all fallback options excluding the failed kind, preserving
 * the original priority order.
 */
export function getAllFallbacks(
  parsed: ParsedPaymentInput,
  failedKind: PaymentOptionKind
): PaymentOption[] {
  return parsed.options.filter((o) => o.kind !== failedKind);
}
