import type { TierEntry } from '@/features/bitchat/hooks/useLocationTiers';

/**
 * Match tiers by `label` prefix OR reverse-geocoded `displayName` substring.
 * BLE ("Bluetooth") only matches ≥3-char queries so stray "bl" doesn't
 * surface it.
 */
export function matchTiers(tiers: TierEntry[], lowerQuery: string): TierEntry[] {
  if (!lowerQuery) return [];
  return tiers.filter((tier) => {
    if (tier.transport === 'ble') {
      return tier.label.toLowerCase().startsWith(lowerQuery) && lowerQuery.length >= 3;
    }
    if (tier.label.toLowerCase().startsWith(lowerQuery)) return true;
    if (tier.displayName?.toLowerCase().includes(lowerQuery)) return true;
    return false;
  });
}
