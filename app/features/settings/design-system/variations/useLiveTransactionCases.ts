/**
 * @fileoverview The wallet's own recent history, in the shape the transaction
 * row variants draw from.
 *
 * Samples are chosen to cover every state; real history shows what a variant
 * looks like on the mix a person actually has (mostly settled, few names, no
 * memos). The mapping is deliberately coarse: it exists to judge a drawing,
 * and a variant that is picked is rebuilt on the real entry, not on this.
 */
import { isP2PKLocked, isSendTokenCancelled } from 'wallet';

import { useHistoryWithMelts } from '@/features/transactions';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';
import { formatAmount } from '@/shared/lib/currency';
import { formatDate, formatRelative } from '@/shared/lib/date';
import { isOutgoingTransaction } from '@/shared/lib/utils';

import type { TransactionCase } from './transactionCases';

const SETTLED = new Set(['finalized', 'PAID', 'ISSUED', 'paid', 'issued', 'completed']);
const FAILED = new Set(['failed', 'EXPIRED', 'expired', 'error']);

type Entry = ReturnType<typeof useHistoryWithMelts>['history'][number];

function toCase(entry: Entry): TransactionCase {
  const outgoing = isOutgoingTransaction(entry);
  const state = String((entry as { state?: unknown }).state ?? '');
  const cancelled = entry.type === 'send' && isSendTokenCancelled(entry);
  const sats = Math.abs(amountToNumber(entry.amount));
  return {
    direction: outgoing ? 'out' : 'in',
    rail:
      entry.type === 'send' || entry.type === 'receive'
        ? 'ecash'
        : getOnchainMintAddress(entry)
          ? 'onchain'
          : 'lightning',
    state: cancelled
      ? 'cancelled'
      : FAILED.has(state)
        ? 'failed'
        : SETTLED.has(state)
          ? 'done'
          : 'pending',
    sats,
    fiat: String(formatAmount({ amount: sats, unit: entry.unit }, { displayAs: 'usd' })),
    locked: isP2PKLocked(entry),
    time: formatDate(entry.createdAt, 'time'),
    ago: formatRelative(entry.createdAt, 'compact'),
  };
}

const LIMIT = 12;

export function useLiveTransactionCases(): readonly { label: string; item: TransactionCase }[] {
  const { history } = useHistoryWithMelts(LIMIT);
  return history.slice(0, LIMIT).map((entry) => ({ label: entry.id, item: toCase(entry) }));
}
