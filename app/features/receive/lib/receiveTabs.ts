import { hasMintSupportingMethod, type WalletContext } from 'wallet';

export type ReceiveTab = 'Lightning' | 'Bolt12' | 'Onchain' | 'P2PK';

/**
 * Amountless receive rails, capability-gated: Bolt12/Onchain appear when ANY
 * trusted mint advertises the method for the active unit (gating only on the
 * selected mint would make tabs flicker on mint change — the tab body shows
 * an empty state instead when the selected mint lacks support). Lightning is
 * always first; P2PK keeps its quickAccessP2PK setting gate.
 */
export function computeReceiveTabs(
  ctx: Pick<WalletContext, 'trustedMintUrls' | 'mintMethodCapabilities'>,
  unit: string,
  quickAccessP2PK: boolean
): ReceiveTab[] {
  const tabs: ReceiveTab[] = ['Lightning'];
  if (hasMintSupportingMethod(ctx, { operation: 'mint', method: 'bolt12', unit })) {
    tabs.push('Bolt12');
  }
  if (hasMintSupportingMethod(ctx, { operation: 'mint', method: 'onchain', unit })) {
    tabs.push('Onchain');
  }
  if (quickAccessP2PK) tabs.push('P2PK');
  return tabs;
}
