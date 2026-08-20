import type { ReactElement } from 'react';

import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';

import { meltSelectedMintHost } from './MeltSelectedMintProbe';

/**
 * Accessibility-only evidence of which mint the amount screen is preselected
 * to. The SwiftUI mint pill (`amount-mint-selector`) swallows its children in
 * the AX tree, so device tests can never read the mint name off the pill —
 * this probe is the only signal that the balance-aware preselection picked
 * the funded mint.
 */
export function AmountSelectedMintProbe({ mintUrl }: { mintUrl: string }): ReactElement {
  const host = meltSelectedMintHost(mintUrl);
  return (
    <E2EAccessibilityProbe
      testID={`amount-selected-mint:${host}`}
      accessibilityLabel={`Selected amount mint ${host}`}
      value={host}
    />
  );
}
