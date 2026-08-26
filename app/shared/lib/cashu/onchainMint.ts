import type { HistoryEntry } from '@cashu/coco-core';
import {
  buildBip321OnchainUri,
  defaultDetectors,
  DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS,
  parsePaymentInput,
  looksLikeBitcoinAddress,
} from 'wallet';

import { amountToNumber, type AmountValue } from '@/shared/lib/cashu/amount';
import { cashuLog } from '@/shared/lib/logger';

type EntryRecord = Record<string, unknown>;

function getBip321OnchainAddress(value: string): string | null {
  if (!value.trim().toLowerCase().startsWith('bitcoin:')) return null;

  try {
    const parsed = parsePaymentInput(value, defaultDetectors);
    const address =
      parsed.options.find((option) => option.kind === 'onchainAddress')?.value ?? null;
    cashuLog.debug('onchain.mint.bip321.parse', {
      inputLength: value.length,
      optionCount: parsed.options.length,
      hasOnchainAddress: !!address,
    });
    return address;
  } catch {
    cashuLog.warn('onchain.mint.bip321.parse_failed', {
      inputLength: value.length,
    });
    return null;
  }
}

export function getOnchainMintAddress(entry: HistoryEntry | null | undefined): string | null {
  if (!entry || entry.type !== 'mint') {
    cashuLog.debug('onchain.mint.address.result', {
      reason: !entry ? 'missing-entry' : 'wrong-type',
      type: entry?.type ?? null,
    });
    return null;
  }

  const metadata = (entry as EntryRecord).metadata;
  const meta = metadata && typeof metadata === 'object' ? (metadata as EntryRecord) : undefined;
  const metadataAddress = meta?.onchainAddress;
  if (meta?.method === 'onchain' && typeof metadataAddress === 'string') {
    const address = metadataAddress.trim();
    if (address) {
      cashuLog.debug('onchain.mint.address.result', {
        reason: 'metadata',
        type: entry.type,
        state:
          typeof (entry as EntryRecord).state === 'string' ? (entry as EntryRecord).state : null,
        addressLength: address.length,
      });
      return address;
    }
  }

  const paymentRequest = (entry as EntryRecord).paymentRequest;
  if (typeof paymentRequest !== 'string') {
    cashuLog.debug('onchain.mint.address.result', {
      reason: 'missing-payment-request',
      type: entry.type,
      state: typeof (entry as EntryRecord).state === 'string' ? (entry as EntryRecord).state : null,
    });
    return null;
  }
  const address = paymentRequest.trim();
  const bip321Address = getBip321OnchainAddress(address);
  if (bip321Address) {
    cashuLog.debug('onchain.mint.address.result', {
      reason: 'bip321',
      type: entry.type,
      state: typeof (entry as EntryRecord).state === 'string' ? (entry as EntryRecord).state : null,
      addressLength: bip321Address.length,
    });
    return bip321Address;
  }
  const directAddress = looksLikeBitcoinAddress(address) ? address : null;
  cashuLog.debug('onchain.mint.address.result', {
    reason: directAddress ? 'direct-address' : 'not-onchain',
    type: entry.type,
    state: typeof (entry as EntryRecord).state === 'string' ? (entry as EntryRecord).state : null,
    paymentRequestLength: address.length,
    addressLength: directAddress?.length ?? null,
  });
  return directAddress;
}

function getMetadata(entry: HistoryEntry | null | undefined): EntryRecord | undefined {
  const metadata = (entry as EntryRecord | null | undefined)?.metadata;
  return metadata && typeof metadata === 'object' ? (metadata as EntryRecord) : undefined;
}

function getObject(value: unknown): EntryRecord | null {
  return value && typeof value === 'object' ? (value as EntryRecord) : null;
}

function getPositiveInteger(value: unknown): number | null {
  const numberValue =
    typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) return null;
  return numberValue;
}

function getOnchainConfirmationsFromQuoteLike(value: unknown): number | null {
  const record = getObject(value);
  if (!record) return null;

  for (const key of [
    'requiredConfirmations',
    'onchainRequiredConfirmations',
    'mintRequiredConfirmations',
    'confirmations',
  ]) {
    const confirmations = getPositiveInteger(record[key]);
    if (confirmations != null) return confirmations;
  }

  for (const key of ['quote', 'quoteData', 'quoteResponse', 'mintQuote', 'mintQuoteResponse']) {
    const nested = getOnchainConfirmationsFromQuoteLike(record[key]);
    if (nested != null) return nested;
  }

  const options = getObject(record.options);
  return getPositiveInteger(options?.confirmations);
}

function getPositiveSatAmount(entry: HistoryEntry | null | undefined): number | null {
  const raw = entry as (EntryRecord & { amount?: AmountValue }) | null | undefined;
  if (!raw || (typeof raw.unit === 'string' && raw.unit !== 'sat')) {
    cashuLog.debug('onchain.mint.amount.result', {
      reason: !raw ? 'missing-entry' : 'unsupported-unit',
      unit: typeof raw?.unit === 'string' ? raw.unit : null,
    });
    return null;
  }

  const metadata = getMetadata(entry);
  const requestedAmount =
    typeof metadata?.requestedAmount === 'string' || typeof metadata?.requestedAmount === 'number'
      ? Number(metadata.requestedAmount)
      : null;
  const amount = Number.isFinite(requestedAmount) ? requestedAmount : amountToNumber(raw.amount);
  if (amount == null) {
    cashuLog.debug('onchain.mint.amount.result', { reason: 'missing-amount' });
    return null;
  }
  const valid = Number.isSafeInteger(amount) && amount > 0;
  cashuLog.debug('onchain.mint.amount.result', {
    reason: valid ? 'valid' : 'invalid',
    source: Number.isFinite(requestedAmount) ? 'metadata.requestedAmount' : 'entry.amount',
    amount,
    isSafeInteger: Number.isSafeInteger(amount),
    isPositive: amount > 0,
  });
  return valid ? amount : null;
}

function getOnchainMintBip321Uri(entry: HistoryEntry | null | undefined): string | null {
  const address = getOnchainMintAddress(entry);
  if (!address) return null;

  const metadata = getMetadata(entry);
  const memo = typeof metadata?.memo === 'string' ? metadata.memo : null;
  const uri = buildBip321OnchainUri(address, {
    amountSats: getPositiveSatAmount(entry),
    message: memo,
  });
  cashuLog.debug('onchain.mint.bip321.build', {
    addressLength: address.length,
    hasMemo: !!memo,
    uriLength: uri.length,
  });
  return uri;
}

export function getMintQuotePaymentValue(entry: HistoryEntry | null | undefined): string | null {
  const onchainUri = getOnchainMintBip321Uri(entry);
  if (onchainUri) {
    cashuLog.debug('onchain.mint.payment_value.result', {
      type: entry?.type ?? null,
      source: 'onchain-bip321',
      valueLength: onchainUri.length,
    });
    return onchainUri;
  }

  const paymentRequest = (entry as EntryRecord | null | undefined)?.paymentRequest;
  const value = typeof paymentRequest === 'string' && paymentRequest.trim() ? paymentRequest : null;
  cashuLog.debug('onchain.mint.payment_value.result', {
    type: entry?.type ?? null,
    source: value ? 'payment-request' : 'missing',
    valueLength: value?.length ?? null,
  });
  return value;
}

/**
 * Confirmation count published on a mint's onchain method settings
 * (`nuts[nutKey].methods[].options.confirmations`) for the given unit —
 * NUT-04 (mint/receive) and NUT-05 (melt/send) publish the same shape.
 * Callers log their own event with the nut-specific source string.
 */
export function getOnchainMethodConfirmations(
  mintInfo: unknown,
  nutKey: '4' | '5',
  unit: string
): number | null {
  const info = mintInfo && typeof mintInfo === 'object' ? (mintInfo as EntryRecord) : null;
  const nuts = info?.nuts && typeof info.nuts === 'object' ? (info.nuts as EntryRecord) : null;
  const nut =
    nuts?.[nutKey] && typeof nuts[nutKey] === 'object' ? (nuts[nutKey] as EntryRecord) : null;
  const methods = Array.isArray(nut?.methods) ? nut.methods : [];

  for (const method of methods) {
    if (!method || typeof method !== 'object') continue;
    const methodRecord = method as EntryRecord;
    if (methodRecord.method !== 'onchain') continue;
    if (typeof methodRecord.unit === 'string' && methodRecord.unit.toLowerCase() !== unit) continue;

    const options =
      methodRecord.options && typeof methodRecord.options === 'object'
        ? (methodRecord.options as EntryRecord)
        : null;
    const confirmations = getPositiveInteger(options?.confirmations);
    if (confirmations != null) return confirmations;
  }

  return null;
}

function getOnchainRequiredConfirmationsFromMintInfo(
  mintInfo: unknown,
  unit = 'sat'
): number | null {
  const confirmations = getOnchainMethodConfirmations(mintInfo, '4', unit);
  if (confirmations != null) {
    cashuLog.debug('onchain.mint.required_confirmations.mint_info', {
      unit,
      source: 'nut04.method.options.confirmations',
      confirmations,
    });
  }
  return confirmations;
}

export function getOnchainRequiredConfirmations(mintInfo: unknown, unit = 'sat'): number {
  const fromMintInfo = getOnchainRequiredConfirmationsFromMintInfo(mintInfo, unit);
  const confirmations = fromMintInfo ?? DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS;
  cashuLog.debug('onchain.mint.required_confirmations.result', {
    unit,
    source: fromMintInfo == null ? 'default' : 'mint-info',
    confirmations,
  });
  return confirmations;
}

export function getOnchainMintQuoteRequiredConfirmations(
  entry: HistoryEntry | null | undefined,
  mintInfo: unknown,
  unit = 'sat'
): number {
  // NUT-04/CDK publish the canonical onchain confirmation count on the mint
  // method setting (`methods[].options.confirmations`). Keep entry/quote
  // metadata first so restored or subscription-fed quote objects can carry
  // their own source-of-truth without waiting for mint info to load.
  const fromEntry = getOnchainConfirmationsFromQuoteLike(entry);
  if (fromEntry != null) {
    cashuLog.debug('onchain.mint.quote_required_confirmations.result', {
      source: 'entry',
      confirmations: fromEntry,
    });
    return fromEntry;
  }

  const fromMetadata = getOnchainConfirmationsFromQuoteLike(getMetadata(entry));
  if (fromMetadata != null) {
    cashuLog.debug('onchain.mint.quote_required_confirmations.result', {
      source: 'metadata',
      confirmations: fromMetadata,
    });
    return fromMetadata;
  }

  const confirmations = getOnchainRequiredConfirmations(mintInfo, unit);
  cashuLog.debug('onchain.mint.quote_required_confirmations.result', {
    source: 'mint-info-or-default',
    confirmations,
  });
  return confirmations;
}

export function buildOnchainRequiredConfirmationProgress(requiredConfirmations: number) {
  const normalizedRequired =
    Number.isSafeInteger(requiredConfirmations) && requiredConfirmations > 0
      ? requiredConfirmations
      : DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS;

  const progress = {
    hasPayment: false,
    hasUnconfirmedPayment: false,
    receivedSats: 0,
    currentConfirmations: null,
    requiredConfirmations: normalizedRequired,
    isSatisfied: false,
  };
  cashuLog.debug('onchain.mint.required_progress.result', {
    requiredConfirmations: normalizedRequired,
    source:
      normalizedRequired === requiredConfirmations
        ? 'provided'
        : 'default-after-invalid-provided-value',
  });
  return progress;
}

export function buildSatisfiedOnchainConfirmationProgress(requiredConfirmations: number) {
  const pending = buildOnchainRequiredConfirmationProgress(requiredConfirmations);
  const progress = {
    ...pending,
    hasPayment: true,
    currentConfirmations: pending.requiredConfirmations,
    isSatisfied: true,
  };
  cashuLog.debug('onchain.mint.satisfied_progress.result', {
    requiredConfirmations: progress.requiredConfirmations,
    isSatisfied: progress.isSatisfied,
  });
  return progress;
}
