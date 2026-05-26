// ---------------------------------------------------------------------------
// BIP-321 helpers
// ---------------------------------------------------------------------------

const SATS_PER_BTC = 100_000_000;

export interface BuildBip321OnchainUriOptions {
  amountSats?: number | null;
  label?: string | null;
  message?: string | null;
}

export function formatSatsAsBtcAmount(amountSats: number): string | null {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) return null;

  const whole = Math.floor(amountSats / SATS_PER_BTC);
  const fractional = amountSats % SATS_PER_BTC;
  if (fractional === 0) return String(whole);

  return `${whole}.${String(fractional).padStart(8, '0').replace(/0+$/, '')}`;
}

export function buildBip321OnchainUri(
  address: string,
  options: BuildBip321OnchainUriOptions = {}
): string {
  const params = new URLSearchParams();
  const amountBtc =
    typeof options.amountSats === 'number' ? formatSatsAsBtcAmount(options.amountSats) : null;

  if (amountBtc) params.set('amount', amountBtc);

  const label = options.label?.trim();
  if (label) params.set('label', label);

  const message = options.message?.trim();
  if (message) params.set('message', message);

  const query = params.toString().replace(/\+/g, '%20');
  return query ? `bitcoin:${address.trim()}?${query}` : `bitcoin:${address.trim()}`;
}
