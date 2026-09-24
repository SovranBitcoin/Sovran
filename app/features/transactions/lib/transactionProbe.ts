import { amountToNumber, type AmountValue } from '@/shared/lib/cashu/amount';
import type { SpendingConditions } from 'wallet';

export type TransactionProbeEntry = {
  type: 'mint' | 'melt' | 'send' | 'receive';
  amount: AmountValue;
  unit: string;
  mintUrl: string;
  state: unknown;
};

/** The lock, as an enum. No keys and no dates cross this seam. */
type TransactionProbeLock = 'none' | 'permanent' | 'timed-active' | 'timed-expired' | 'unknown';

/** Whether the sender can take it back, as an enum. Same rule. */
type TransactionProbeReclaim = 'none' | 'never' | 'at' | 'now' | 'unknown';

type TransactionProbe = {
  direction: 'in' | 'out';
  amount: number;
  unit: string;
  mintHost: string;
  status: string;
  source: string | null;
  lock: TransactionProbeLock;
  reclaim: TransactionProbeReclaim;
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

function probeLock(conditions?: SpendingConditions | null): TransactionProbeLock {
  if (!conditions || conditions.kind === 'unlocked') return 'none';
  if (conditions.kind !== 'p2pk') return 'unknown';
  return conditions.phase ?? 'unknown';
}

function probeReclaim(conditions?: SpendingConditions | null): TransactionProbeReclaim {
  if (!conditions) return 'none';
  const { reclaim } = conditions;
  return reclaim.kind === 'not-locked' ? 'none' : reclaim.kind;
}

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
  source?: string | null,
  conditions?: SpendingConditions | null
): TransactionProbe {
  return {
    direction: entry.type === 'melt' || entry.type === 'send' ? 'out' : 'in',
    amount: amountToNumber(entry.amount),
    unit: entry.unit,
    mintHost: mintHost(entry.mintUrl),
    status: String(entry.state),
    source: canonicalSource(source),
    // Enums only. A date would let a scenario assert a locktime, which means
    // writing one into a fixture, which means the harness starts carrying
    // payment material it has no business holding.
    lock: probeLock(conditions),
    reclaim: probeReclaim(conditions),
  };
}

export function serializeTransactionProbe(
  entry: TransactionProbeEntry,
  source?: string | null,
  conditions?: SpendingConditions | null
): string {
  return JSON.stringify(createTransactionProbe(entry, source, conditions));
}
