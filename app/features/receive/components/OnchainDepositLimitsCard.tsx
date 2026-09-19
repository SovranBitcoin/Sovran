/**
 * The mint's NUT-04 onchain deposit bounds, placed directly under every
 * onchain receive QR (Unified tab, Onchain tab, fixed-amount onchain request).
 * The payer can send any amount to the address, so the bounds must be visible
 * whether or not the QR carries a requested amount.
 */

import { getMintMethodCapability } from 'wallet';

import { getOnchainDepositLimitsNotice } from '@/features/receive/lib/onchainDepositLimits';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { Notice } from '@/shared/ui/composed/Notice';

interface OnchainDepositLimitsCardProps {
  /** The mint that owns the address — not a selector's current pick. */
  mintUrl: string | null | undefined;
  unit: string;
  /** The amount the QR requests, when it carries one. */
  requestedAmount?: number | null;
  /** Outer spacing belongs to the parent: pass `mt-3` in a plain fragment,
   *  nothing inside a stack that already has a gap. */
  className?: string;
}

export function OnchainDepositLimitsCard({
  mintUrl,
  unit,
  requestedAmount = null,
  className,
}: OnchainDepositLimitsCardProps) {
  const walletContext = useWalletContext();
  const notice = mintUrl
    ? getOnchainDepositLimitsNotice(
        getMintMethodCapability(walletContext, mintUrl, {
          operation: 'mint',
          method: 'onchain',
          unit,
        }),
        requestedAmount,
        unit
      )
    : null;
  if (!notice) return null;
  return (
    <Notice
      status="warning"
      title={notice.title}
      description={notice.description}
      className={`mx-4 ${className ?? ''}`}
      testID="receive-onchain-deposit-limits"
    />
  );
}
