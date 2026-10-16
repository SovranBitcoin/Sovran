import { isFiatUnit } from 'wallet/units';

import { formatAmount } from '@/shared/lib/currency';
import type { CtaBodyView } from '@/shared/lib/cta/types';
import type { LegacyClaimPrompt } from '@/shared/stores/global/legacyEcashStore';

/** The mint's address as a person reads it: host and path, without the scheme. */
function mintHost(mintUrl: string): string {
  return mintUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/**
 * The amount as the prompt shows it, or null when the unit is one the app has
 * no way to write. The prompt then asks without an amount instead of showing a
 * bare number that could be read as sats.
 */
function formatLegacyClaimAmount({ amount, unit }: LegacyClaimPrompt): string | null {
  if (unit === 'sat') return amount === 1 ? '1 sat' : `${amount.toLocaleString('en-US')} sats`;
  if (unit === null || !isFiatUnit(unit)) return null;
  return `${formatAmount({ amount, unit })} ${unit.toUpperCase()}`;
}

/** The mint and amount as the prompt's body names them. */
export function describeLegacyClaim(
  claim: LegacyClaimPrompt,
  mintName: string | undefined
): NonNullable<CtaBodyView['oldEcash']> {
  const host = mintHost(claim.mintUrl);
  return {
    mint: mintName ? `${mintName} (${host})` : host,
    amount: formatLegacyClaimAmount(claim),
  };
}
