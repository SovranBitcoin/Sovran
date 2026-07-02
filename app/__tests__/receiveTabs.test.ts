/**
 * @jest-environment node
 *
 * Receive-hub tab layout: four permanent high-level rails. Lightning hosts
 * the address/BOLT 12 mode switcher; Cashu hosts the P2PK lock toggle.
 */

import { computeReceiveTabs } from '@/features/receive/lib/receiveTabs';

describe('computeReceiveTabs', () => {
  it('returns the four high-level rails', () => {
    expect(computeReceiveTabs()).toEqual(['Lightning', 'Unified', 'Onchain', 'Cashu']);
  });
});
