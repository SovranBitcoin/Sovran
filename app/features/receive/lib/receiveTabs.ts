type ReceiveTab = 'Lightning' | 'Unified' | 'Onchain' | 'Cashu';

/**
 * The four high-level receive rails. Lightning hosts both the npub.cash
 * address and the BOLT 12 offer behind a visible mode switcher; Cashu hosts
 * the NUT-18 payment request with an optional P2PK lock (absorbing the old
 * P2PK tab); Unified is the BIP-321 composition of the standing rails. Every
 * tab is permanent — tab bodies own their empty/discovery states.
 */
export function computeReceiveTabs(): ReceiveTab[] {
  return ['Lightning', 'Unified', 'Onchain', 'Cashu'];
}
