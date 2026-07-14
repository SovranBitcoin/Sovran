import { amountToNumber, type AmountValue } from '@/shared/lib/cashu/amount';

export type TransactionProbeEntry = {
  type: 'mint' | 'melt' | 'send' | 'receive';
  amount: AmountValue;
  unit: string;
  mintUrl: string;
  state: unknown;
};

export type TransactionProbe = {
  direction: 'in' | 'out';
  amount: number;
  unit: string;
  mintHost: string;
  status: string;
  source: string | null;
};

const SOURCE_LABEL_TO_CANONICAL: Readonly<Record<string, string>> = {
  clipboard: 'paste',
  'qr code': 'qr',
  'deep link': 'deeplink',
  bluetooth: 'ble',
  copied: 'copy',
  shared: 'share',
};

const CANONICAL_SOURCES = new Set([
  'qr',
  'nfc',
  'paste',
  'deeplink',
  'ble',
  'copy',
  'share',
  'airdrop',
  'displayed',
  'npc',
]);

function mintHost(mintUrl: string): string {
  try {
    return new URL(mintUrl).hostname.toLowerCase();
  } catch {
    // Never fall back to the raw value: malformed input could contain a path,
    // query, token, or other payment material. The probe is an allowlist.
    return 'unknown';
  }
}

function canonicalSource(source?: string | null): string | null {
  const normalized = source?.trim().toLowerCase();
  if (!normalized) return null;
  return (
    SOURCE_LABEL_TO_CANONICAL[normalized] ?? (CANONICAL_SOURCES.has(normalized) ? normalized : null)
  );
}

/**
 * Builds the complete, deliberately small device-test view of a transaction.
 * No operation/quote ids, tokens, invoices, destinations, metadata, or errors
 * cross this seam; the transaction reference lives only in the element testID.
 */
export function createTransactionProbe(
  entry: TransactionProbeEntry,
  source?: string | null
): TransactionProbe {
  return {
    direction: entry.type === 'melt' || entry.type === 'send' ? 'out' : 'in',
    amount: amountToNumber(entry.amount),
    unit: entry.unit,
    mintHost: mintHost(entry.mintUrl),
    status: String(entry.state),
    source: canonicalSource(source),
  };
}

export function serializeTransactionProbe(
  entry: TransactionProbeEntry,
  source?: string | null
): string {
  return JSON.stringify(createTransactionProbe(entry, source));
}
