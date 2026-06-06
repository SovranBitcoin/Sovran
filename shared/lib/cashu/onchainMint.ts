import type { HistoryEntry } from '@cashu/coco-core';
import {
  buildBip321OnchainUri,
  defaultDetectors,
  DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS,
  parsePaymentInput,
} from '@sovranbitcoin/colada';

import { amountToNumber, type AmountValue } from '@/shared/lib/cashu/amount';

type EntryRecord = Record<string, unknown>;

function looksLikeBitcoinAddress(value: string): boolean {
  const candidate = value.trim();
  if (!candidate) return false;

  if (/^(bc|tb|bcrt)1[ac-hj-np-z02-9]{11,87}$/i.test(candidate)) return true;
  return /^[123mn2][1-9A-HJ-NP-Za-km-z]{25,62}$/.test(candidate);
}

function getBip321OnchainAddress(value: string): string | null {
  if (!value.trim().toLowerCase().startsWith('bitcoin:')) return null;

  try {
    const parsed = parsePaymentInput(value, defaultDetectors);
    return parsed.options.find((option) => option.kind === 'onchainAddress')?.value ?? null;
  } catch {
    return null;
  }
}

export function getOnchainMintAddress(entry: HistoryEntry | null | undefined): string | null {
  if (!entry || entry.type !== 'mint') return null;

  const metadata = (entry as EntryRecord).metadata;
  const meta = metadata && typeof metadata === 'object' ? (metadata as EntryRecord) : undefined;
  const metadataAddress = meta?.onchainAddress;
  if (meta?.method === 'onchain' && typeof metadataAddress === 'string') {
    const address = metadataAddress.trim();
    if (address) return address;
  }

  const paymentRequest = (entry as EntryRecord).paymentRequest;
  if (typeof paymentRequest !== 'string') return null;
  const address = paymentRequest.trim();
  const bip321Address = getBip321OnchainAddress(address);
  if (bip321Address) return bip321Address;
  return looksLikeBitcoinAddress(address) ? address : null;
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
  if (!raw || (typeof raw.unit === 'string' && raw.unit !== 'sat')) return null;

  const metadata = getMetadata(entry);
  const requestedAmount =
    typeof metadata?.requestedAmount === 'string' || typeof metadata?.requestedAmount === 'number'
      ? Number(metadata.requestedAmount)
      : null;
  const amount = Number.isFinite(requestedAmount) ? requestedAmount : amountToNumber(raw.amount);
  if (amount == null) return null;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function getOnchainMintBip321Uri(entry: HistoryEntry | null | undefined): string | null {
  const address = getOnchainMintAddress(entry);
  if (!address) return null;

  const metadata = getMetadata(entry);
  const memo = typeof metadata?.memo === 'string' ? metadata.memo : null;
  return buildBip321OnchainUri(address, {
    amountSats: getPositiveSatAmount(entry),
    message: memo,
  });
}

export function getMintQuotePaymentValue(entry: HistoryEntry | null | undefined): string | null {
  const onchainUri = getOnchainMintBip321Uri(entry);
  if (onchainUri) return onchainUri;

  const paymentRequest = (entry as EntryRecord | null | undefined)?.paymentRequest;
  return typeof paymentRequest === 'string' && paymentRequest.trim() ? paymentRequest : null;
}

function getOnchainRequiredConfirmationsFromMintInfo(
  mintInfo: unknown,
  unit = 'sat'
): number | null {
  const info = mintInfo && typeof mintInfo === 'object' ? (mintInfo as EntryRecord) : null;
  const nuts = info?.nuts && typeof info.nuts === 'object' ? (info.nuts as EntryRecord) : null;
  const nut04 = nuts?.['4'] && typeof nuts['4'] === 'object' ? (nuts['4'] as EntryRecord) : null;
  const methods = Array.isArray(nut04?.methods) ? nut04.methods : [];

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
    if (confirmations != null) {
      return confirmations;
    }
  }

  return null;
}

export function getOnchainRequiredConfirmations(mintInfo: unknown, unit = 'sat'): number {
  return (
    getOnchainRequiredConfirmationsFromMintInfo(mintInfo, unit) ??
    DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS
  );
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
  if (fromEntry != null) return fromEntry;

  const fromMetadata = getOnchainConfirmationsFromQuoteLike(getMetadata(entry));
  if (fromMetadata != null) return fromMetadata;

  return getOnchainRequiredConfirmations(mintInfo, unit);
}

export function buildOnchainRequiredConfirmationProgress(requiredConfirmations: number) {
  const normalizedRequired =
    Number.isSafeInteger(requiredConfirmations) && requiredConfirmations > 0
      ? requiredConfirmations
      : DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS;

  return {
    hasPayment: false,
    hasUnconfirmedPayment: false,
    receivedSats: 0,
    currentConfirmations: null,
    requiredConfirmations: normalizedRequired,
    isSatisfied: false,
  };
}

export function buildSatisfiedOnchainConfirmationProgress(requiredConfirmations: number) {
  const pending = buildOnchainRequiredConfirmationProgress(requiredConfirmations);
  return {
    ...pending,
    hasPayment: true,
    currentConfirmations: pending.requiredConfirmations,
    isSatisfied: true,
  };
}
