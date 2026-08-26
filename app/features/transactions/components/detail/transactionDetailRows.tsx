import type { AmountValue } from '@/shared/lib/cashu/amount';
import { formatAmount } from '@/shared/lib/currency';
import { truncateMiddle } from '@/shared/lib/strings';
import { CopyableValue } from '@/shared/ui/composed/CopyableValue';

/**
 * The trailing `DetailsSection` rows every transaction-detail screen builds
 * after `transactionLeadDetailItems` — Amount, State, Quote ID, Mint. Each
 * screen was rebuilding these literals by hand, so the title, truncation
 * width, and copy affordance drifted independently across seven screens.
 *
 * Builders that gate on an optional value return `null` for the falsy case —
 * `DetailsSection` drops falsy items — so they inline directly into an item
 * list. Ordering (and the screen-specific rows interleaved between these)
 * stays with each screen.
 */

export function amountDetailItem({ amount, unit }: { amount: AmountValue; unit: string }) {
  return { title: 'Amount', value: formatAmount({ amount, unit }) };
}

export function stateDetailItem(state: string) {
  return { title: 'State', value: state };
}

/**
 * Copyable Quote ID row (Lightning mint/melt screens). The onchain screens
 * deliberately render a plain truncated Quote ID instead — don't fold them in
 * here without a product decision to make those copyable too.
 */
export function quoteIdDetailItem(quoteId: string | undefined) {
  return quoteId
    ? {
        title: 'Quote ID',
        value: (
          <CopyableValue
            value={quoteId}
            display={truncateMiddle(quoteId, 7)}
            copyTarget="quoteId"
          />
        ),
      }
    : null;
}

export function mintDetailItem(mintUrl: string | null | undefined) {
  return mintUrl ? { title: 'Mint', value: truncateMiddle(mintUrl, 12) } : null;
}
