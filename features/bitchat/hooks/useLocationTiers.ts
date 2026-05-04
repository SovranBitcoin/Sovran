import { useState, useEffect } from 'react';
import * as Location from 'expo-location';
import { encodeGeohash, type LocationTier } from 'bitchat-module';
import { LOCATION_TIERS, BLUETOOTH_TIER } from '../lib/constants';
import { bitchatLog } from '@/shared/lib/logger';

export interface TierEntry extends LocationTier {
  transport: 'ble' | 'nostr';
  icon: string;
  /**
   * Reverse-geocoded friendly name for this tier, e.g. "United Kingdom" for
   * region, "London" for city. Undefined if reverse geocoding failed or the
   * tier is the Bluetooth entry. Rendered as `~{displayName}` by
   * ContactRow's geohash identity, matching upstream bitchat's convention.
   */
  displayName?: string;
}

type TierKey = (typeof LOCATION_TIERS)[number]['key'];

function namesFromPlacemark(
  pm: Location.LocationGeocodedAddress
): Record<TierKey, string | undefined> {
  // Intentionally NOT returning names for `block` or `neighborhood`:
  // those tiers are precise enough that a reverse-geocoded name (street,
  // district, etc.) reveals more about the user than the geohash itself
  // already does. Showing `#geohash` alone keeps the row informative
  // without leaking the street address. Region / Province / City are
  // coarse enough that the place name is fine.
  return {
    region: pm.country || pm.isoCountryCode || undefined,
    province: pm.subregion || pm.region || undefined,
    city: pm.city || pm.subregion || pm.region || undefined,
    neighborhood: undefined,
    block: undefined,
  };
}

export function useLocationTiers() {
  const [tiers, setTiers] = useState<TierEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function compute() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setError('Location permission not granted');
          setLoading(false);
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (cancelled) return;

        const { latitude, longitude } = location.coords;

        const bluetoothEntry: TierEntry = {
          key: BLUETOOTH_TIER.key,
          label: BLUETOOTH_TIER.label,
          precision: 0,
          geohash: 'mesh',
          transport: 'ble',
          icon: BLUETOOTH_TIER.icon,
        };

        const locationEntries: TierEntry[] = LOCATION_TIERS.map((tier) => ({
          key: tier.key,
          label: tier.label,
          precision: tier.precision,
          geohash: encodeGeohash(latitude, longitude, tier.precision),
          transport: 'nostr' as const,
          icon: tier.icon,
        }));

        setTiers([bluetoothEntry, ...locationEntries]);
        setError(null);

        // Reverse geocode after the tiers are on screen so we don't block the
        // initial render. Apple rate-limits CLGeocoder aggressively, so we do
        // one lookup and apply the result to every tier at once.
        try {
          const places = await Location.reverseGeocodeAsync({ latitude, longitude });
          if (cancelled || places.length === 0) return;
          const names = namesFromPlacemark(places[0]);
          setTiers((prev) =>
            prev.map((tier) => {
              if (tier.transport === 'ble') return tier;
              const name = names[tier.key as TierKey];
              return name ? { ...tier, displayName: name } : tier;
            })
          );
        } catch (e) {
          // Reverse geocoding is best-effort; tiers still work without it.
          bitchatLog.warn('bitchat.location_tiers.reverse_geocode_failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to get location');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    compute();
    return () => {
      cancelled = true;
    };
  }, []);

  return { tiers, loading, error };
}
