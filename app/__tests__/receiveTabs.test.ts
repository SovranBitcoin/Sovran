/**
 * @jest-environment node
 *
 * Receive-hub tab layout. Bolt12/Onchain are permanent rails (the tab body
 * owns the "None of your mints support …" discovery state — hiding the tab
 * would make that CTA unreachable); only P2PK is gated, by its quick-access
 * setting.
 */

import { computeReceiveTabs } from '@/features/receive/lib/receiveTabs';

describe('computeReceiveTabs', () => {
  it('always shows Lightning, Bolt12, and Onchain', () => {
    expect(computeReceiveTabs(false)).toEqual(['Lightning', 'BOLT 12', 'Onchain', 'Cashu']);
  });

  it('appends P2PK when quick access is enabled', () => {
    expect(computeReceiveTabs(true)).toEqual(['Lightning', 'BOLT 12', 'Onchain', 'Cashu', 'P2PK']);
  });
});
