import { isLightningInvoiceBolt11, parseLightningAddress, requestInvoiceFromLnurl } from 'wallet';

export type RequestLightningAddressInvoice = (
  address: string,
  amountSats: number
) => Promise<string>;

/**
 * Resolve a Lightning address for one exact sat-denominated funded-test
 * payment. LNURL fetching, callback hardening, and encoded-amount validation
 * remain owned by the wallet implementation.
 */
export async function resolveLightningAddressInvoice(
  address: string,
  amountSats: number,
  requestInvoice: RequestLightningAddressInvoice = requestInvoiceFromLnurl,
  timeoutMs = 60_000
): Promise<string> {
  if (!parseLightningAddress(address)) {
    throw new Error('invalid Lightning address');
  }
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    throw new Error('Lightning-address amount must be a positive integer number of sats');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600_000) {
    throw new Error('Lightning-address timeout must be a bounded positive integer');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const invoice = await Promise.race([
    requestInvoice(address, amountSats),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Lightning-address resolution timed out')),
        timeoutMs
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
  if (
    typeof invoice !== 'string' ||
    invoice !== invoice.trim() ||
    !isLightningInvoiceBolt11(invoice)
  ) {
    throw new Error('Lightning-address resolver returned an invalid BOLT11 invoice');
  }
  return invoice;
}
