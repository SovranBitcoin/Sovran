import type { ReactElement } from 'react';

import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';

export function meltSelectedMintHost(mintUrl: string): string {
  try {
    return new URL(mintUrl).hostname.toLowerCase() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Accessibility-only evidence that binds a melt screen's selected mint to its
 * current entry id. The host-scoped prefix lets device tests wait for and
 * capture the replacement preview without accidentally reusing the old one.
 */
export function MeltSelectedMintProbe({
  mintUrl,
  transactionId,
}: {
  mintUrl: string;
  transactionId: string;
}): ReactElement {
  const host = meltSelectedMintHost(mintUrl);
  return (
    <E2EAccessibilityProbe
      testID={`melt-selected-mint:${host}:${transactionId}`}
      accessibilityLabel={`Selected payment mint ${host}`}
      value={host}
    />
  );
}
