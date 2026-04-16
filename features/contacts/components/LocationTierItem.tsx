import React from 'react';
import { useRouter } from 'expo-router';
import opacity from 'hex-color-opacity';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { ListRow } from '@/shared/ui/composed/ListRow';
import Icon from 'assets/icons';
import type { TierEntry } from '@/features/bitchat/hooks/useLocationTiers';

interface LocationTierItemProps {
  tier: TierEntry;
}

const BLE_COLOR = '#0A84FF';

export const LocationTierItem = React.memo(function LocationTierItem({
  tier,
}: LocationTierItemProps) {
  const router = useRouter();
  const [foreground, accent] = useThemeColor(['foreground', 'accent'] as const);

  const isBluetooth = tier.transport === 'ble';
  const iconColor = isBluetooth ? BLE_COLOR : accent;

  const subtitle = isBluetooth
    ? 'Nearby via Bluetooth mesh'
    : tier.displayName
      ? `~${tier.displayName} · #${tier.geohash}`
      : `#${tier.geohash}`;

  return (
    <ListRow
      iconCircle={{
        icon: tier.icon,
        color: iconColor,
        backgroundColor: opacity(iconColor, 0.12),
      }}
      title={tier.label}
      subtitle={subtitle}
      trailing={
        <Icon name="mdi:chevron-right" size={18} color={opacity(foreground, 0.25)} />
      }
      onPress={() => {
        router.push({
          pathname: '/(user-flow)/geohashChat',
          params: {
            geohash: tier.geohash,
            tierLabel: tier.label,
            transport: tier.transport,
          },
        } as any);
      }}
    />
  );
});
