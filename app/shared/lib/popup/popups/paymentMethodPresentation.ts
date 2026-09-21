/**
 * How a detected payment option is named and iconed in "Choose how to pay".
 *
 * The user is choosing a RAIL, not a wire format: a BOLT-12 offer is Lightning
 * exactly as an invoice or a lightning address is. Kept apart from the sheet so
 * it stays a pure table (no UI imports) that can be read and tested directly.
 */
import type { AnnotatedOption } from 'wallet';

type PaymentOptionKind = AnnotatedOption['option']['kind'];

/**
 * Keyed by EVERY kind on purpose. This was two membership lists with a
 * `return kind` fallthrough, so the one kind in neither — `bolt12Offer` — was
 * shown to the user as its own raw enum name. With a total record a new kind
 * fails to compile instead of leaking.
 */
export const METHOD_PRESENTATION: Record<PaymentOptionKind, { label: string; icon: string }> = {
  ecashToken: { label: 'Cashu', icon: 'majesticons:coins' },
  paymentRequest: { label: 'Cashu', icon: 'majesticons:coins' },
  lightningInvoice: { label: 'Lightning', icon: 'mdi:lightning-bolt' },
  bolt12Offer: { label: 'Lightning', icon: 'mdi:lightning-bolt' },
  lightningAddress: { label: 'Lightning', icon: 'mdi:lightning-bolt' },
  lnurlp: { label: 'Lightning', icon: 'mdi:lightning-bolt' },
  onchainAddress: { label: 'Onchain', icon: 'hugeicons:blockchain-01' },
};

export function getMethodLabel(kind: PaymentOptionKind): string {
  return METHOD_PRESENTATION[kind].label;
}

export function getMethodIcon(kind: PaymentOptionKind): string {
  return METHOD_PRESENTATION[kind].icon;
}
