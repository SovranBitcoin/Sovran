import { hasFeature, type Feature } from '@/shared/config/features';

type ReceiveTab = 'Lightning' | 'Unified' | 'Onchain' | 'Cashu';

/**
 * The four high-level receive rails. Lightning hosts both the npub.cash
 * address and the BOLT 12 offer behind a visible mode switcher; Cashu hosts
 * the NUT-18 payment request with an optional P2PK lock (absorbing the old
 * P2PK tab); Unified is the BIP-321 composition of the standing rails. Every
 * tab the build ships is permanent — tab bodies own their empty/discovery
 * states. Unified only earns its place when it composes two or more rails.
 */
const TAB_FEATURE: Record<Exclude<ReceiveTab, 'Unified'>, Feature> = {
  Lightning: 'lightning',
  Onchain: 'onchain',
  Cashu: 'ecash',
};

export function computeReceiveTabs(
  enabled: (feature: Feature) => boolean = hasFeature
): ReceiveTab[] {
  const rails = (['Lightning', 'Onchain', 'Cashu'] as const).filter((tab) =>
    enabled(TAB_FEATURE[tab])
  );
  return rails.length > 1 ? ['Unified', ...rails] : rails;
}
