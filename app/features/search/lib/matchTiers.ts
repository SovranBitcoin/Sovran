import type { TierEntry } from '@/features/bitchat/hooks/useLocationTiers';

/**
 * Words that find the Bluetooth mesh row. People call it by any of these;
 * none of them needs the location.
 */
const BLUETOOTH_KEYWORDS = ['bluetooth', 'mesh', 'nearby', 'bitchat'] as const;

/** Bluetooth needs three characters, so a stray "bl" or "me" does not surface it. */
const BLUETOOTH_MIN_QUERY = 3;

/**
 * Match tiers by `label` prefix OR reverse-geocoded `displayName` substring.
 * The Bluetooth row matches a prefix of any of its keywords from three
 * characters.
 */
export function matchTiers(tiers: readonly TierEntry[], lowerQuery: string): TierEntry[] {
  if (!lowerQuery) return [];
  return tiers.filter((tier) => {
    if (tier.transport === 'ble') {
      if (lowerQuery.length < BLUETOOTH_MIN_QUERY) return false;
      return [tier.label.toLowerCase(), ...BLUETOOTH_KEYWORDS].some((word) =>
        word.startsWith(lowerQuery)
      );
    }
    if (tier.label.toLowerCase().startsWith(lowerQuery)) return true;
    if (tier.displayName?.toLowerCase().includes(lowerQuery)) return true;
    return false;
  });
}
