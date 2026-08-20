import type { ReactElement } from 'react';

import { meltSelectedMintHost } from '@/features/send/components/MeltSelectedMintProbe';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { useMintStore } from '@/shared/stores/profile/mintStore';

/**
 * Accessibility-only evidence of the wallet's currently preferred mint. The
 * header mint pill (`wallet-mint-selector`) carries a data-bearing AX label
 * (name + balance), so device tests can never pin the selected mint off the
 * pill itself — this probe is the only stable signal that a unit switch
 * re-snapped `selectedMint` (e.g. USD → mint.cubabitcoin.org).
 */
export function WalletSelectedMintProbe(): ReactElement | null {
  const selectedMint = useMintStore((state) => state.selectedMint);
  const host = selectedMint ? meltSelectedMintHost(selectedMint) : undefined;
  if (!host) return null;
  return (
    <E2EAccessibilityProbe
      testID={`wallet-selected-mint:${host}`}
      accessibilityLabel={`Selected wallet mint ${host}`}
      value={host}
    />
  );
}
