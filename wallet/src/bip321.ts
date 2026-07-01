// ---------------------------------------------------------------------------
// BIP-321 helpers
// ---------------------------------------------------------------------------

import { logger } from './logger';

const SATS_PER_BTC = 100_000_000;

export interface BuildBip321OnchainUriOptions {
  amountSats?: number | null;
  label?: string | null;
  message?: string | null;
}

export function formatSatsAsBtcAmount(amountSats: number): string | null {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    logger.warn('bip321.amount.invalid', {
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
    logger.debug('bip321.amount.formatted', {
      amountSats,
      hasFractional: false,
      outputLength: formatted.length,
    });
    return formatted;
  }

  const formatted = `${whole}.${String(fractional).padStart(8, '0').replace(/0+$/, '')}`;
  logger.debug('bip321.amount.formatted', {
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
  logger.info('bip321.uri.build.start', {
    addressLength: trimmedAddress.length,
    hasAmountSats: typeof options.amountSats === 'number',
    hasLabel: !!options.label?.trim(),
    hasMessage: !!options.message?.trim(),
  });
  const params = new URLSearchParams();
  const amountBtc =
    typeof options.amountSats === 'number'
      ? formatSatsAsBtcAmount(options.amountSats)
      : null;

  if (amountBtc) params.set('amount', amountBtc);

  const label = options.label?.trim();
  if (label) params.set('label', label);

  const message = options.message?.trim();
  if (message) params.set('message', message);

  const query = params.toString().replace(/\+/g, '%20');
  const uri = query
    ? `bitcoin:${trimmedAddress}?${query}`
    : `bitcoin:${trimmedAddress}`;
  logger.info('bip321.uri.build.done', {
    addressLength: trimmedAddress.length,
    paramCount: Array.from(params.keys()).length,
    hasAmount: params.has('amount'),
    hasLabel: params.has('label'),
    hasMessage: params.has('message'),
    uriLength: uri.length,
  });
  return uri;
}
