type ReceiveTab = 'Lightning' | 'BOLT 12' | 'Onchain' | 'P2PK';

/**
 * Amountless receive rails. Bolt12/Onchain are ALWAYS shown: when no trusted
 * mint supports the method, the tab body renders a "None of your mints
 * support …" state with a CTA into mint discovery (filtered by method) — the
 * tab is how the user finds out the rail exists. Lightning is always first;
 * P2PK keeps its quickAccessP2PK setting gate.
 */
export function computeReceiveTabs(quickAccessP2PK: boolean): ReceiveTab[] {
  const tabs: ReceiveTab[] = ['Lightning', 'BOLT 12', 'Onchain'];
  if (quickAccessP2PK) tabs.push('P2PK');
  return tabs;
}
