/**
 * Wording for the onchain deposit-limits notice under every onchain receive QR.
 * Lives with the receive feature (it is receive copy) rather than in the
 * shared onchain-mint helpers, so those stay free of the settings-backed
 * amount formatter.
 */

import type { MintMethodUnitCapability } from 'wallet';

import { formatAmount } from '@/shared/lib/currency';
import { cashuLog } from '@/shared/lib/logger';

interface OnchainDepositLimitsNotice {
  /** Which advertised bound the requested amount breaks; null when it fits or
   *  there is no requested amount (the notice then just states the limits). */
  outOfRange: 'min' | 'max' | null;
  title: string;
  description: string;
}

const LOST_DEPOSIT_CONSEQUENCE = "won't be credited and could be lost.";

/**
 * Onchain mint quotes are amountless at the mint: any requested amount only
 * rides in the BIP-321 URI, so nothing stops the payer sending an amount the
 * mint's NUT-04 onchain bounds won't credit. Every onchain receive QR states
 * those bounds, and names the broken bound when the requested amount is
 * outside them. Returns null when the mint advertises no bound (or cannot
 * mint onchain).
 */
export function getOnchainDepositLimitsNotice(
  capability: MintMethodUnitCapability | null,
  requestedAmount: number | null,
  /** The unit the QR receives in. The wallet derives capabilities for the
   *  active unit only, so bounds in any other unit would be the wrong numbers. */
  receiveUnit: string
): OnchainDepositLimitsNotice | null {
  if (!capability?.supported || capability.disabled) return null;
  if (capability.unit !== receiveUnit.trim().toLowerCase()) return null;
  const { minAmount, maxAmount, unit } = capability;
  const withUnit = (amount: number) => formatAmount({ amount, unit }, { currencyDisplay: 'name' });
  const outOfRange =
    requestedAmount == null
      ? null
      : minAmount != null && requestedAmount < minAmount
        ? 'min'
        : maxAmount != null && requestedAmount > maxAmount
          ? 'max'
          : null;
  cashuLog.debug('onchain.mint.deposit_limits', {
    minAmount: minAmount ?? null,
    maxAmount: maxAmount ?? null,
    hasRequestedAmount: requestedAmount != null,
    outOfRange,
  });
  if (outOfRange === 'min' && minAmount != null) {
    return {
      outOfRange,
      title: 'Amount below mint minimum',
      description: `This mint only credits onchain deposits of at least ${withUnit(minAmount)}. A smaller deposit ${LOST_DEPOSIT_CONSEQUENCE}`,
    };
  }
  if (outOfRange === 'max' && maxAmount != null) {
    return {
      outOfRange,
      title: 'Amount above mint maximum',
      description: `This mint only credits onchain deposits of up to ${withUnit(maxAmount)}. A larger deposit ${LOST_DEPOSIT_CONSEQUENCE}`,
    };
  }
  let description: string;
  if (minAmount != null && maxAmount != null) {
    const min = formatAmount({ amount: minAmount, unit });
    description = `Send between ${min} and ${withUnit(maxAmount)}. Deposits outside this range ${LOST_DEPOSIT_CONSEQUENCE}`;
  } else if (minAmount != null) {
    description = `Send at least ${withUnit(minAmount)}. Smaller deposits ${LOST_DEPOSIT_CONSEQUENCE}`;
  } else if (maxAmount != null) {
    description = `Send at most ${withUnit(maxAmount)}. Larger deposits ${LOST_DEPOSIT_CONSEQUENCE}`;
  } else {
    return null;
  }
  return { outOfRange: null, title: 'Onchain deposit limits', description };
}
