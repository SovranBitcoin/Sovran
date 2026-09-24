import { useMemo } from 'react';
import { View } from 'react-native';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Avatar } from '@/shared/ui/primitives/Avatar';

import type { ProviderStatus } from '@/shared/lib/routstr/providerHealth';

/**
 * A provider's face in the picker, with a liveness dot on its corner.
 *
 * Routstr nodes publish a name and a description but no icon, so this leans on
 * the app's own seeded `Avatar` — the same generated identity every person
 * without a picture gets — keyed on the provider's URL. Deterministic by
 * construction: the same provider looks the same on every launch and every
 * device, which is what makes a list of near-identical URLs scannable.
 *
 * The dot is the structural twin of an avatar's presence badge: bottom-right,
 * ringed in the surface colour so it reads as sitting on top rather than
 * punched through. `unknown` shows nothing rather than a colour, because an
 * unprobed provider is not the same claim as a working one.
 */

interface ProviderAvatarProps {
  name: string;
  baseUrl: string;
  status?: ProviderStatus;
  size?: number;
}

/** Size, hue and the status colour are all runtime values, so they travel as a
 *  style object; everything static is a class. */
function useStatusDotStyle(status: ProviderStatus, size: number) {
  const [background, success, danger] = useThemeColor(['background', 'success', 'danger'] as const);
  const dotSize = Math.max(9, Math.round(size * 0.3));
  const color = status === 'online' ? success : status === 'offline' ? danger : null;
  return useMemo(
    () =>
      color
        ? {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: color,
            borderColor: background,
          }
        : null,
    [background, color, dotSize]
  );
}

const DOT_CLASS = 'absolute -right-px -bottom-px border-2';

export function ProviderAvatar({
  name,
  baseUrl,
  status = 'unknown',
  size = 36,
}: ProviderAvatarProps) {
  const dotStyle = useStatusDotStyle(status, size);

  return (
    <View className="relative" accessibilityLabel={`${name || baseUrl} provider`}>
      <Avatar state="fallback" seed={baseUrl} size={size} alt={name || baseUrl} />
      {dotStyle ? <View className={DOT_CLASS} style={dotStyle} /> : null}
    </View>
  );
}

/** The same badge on the tab header's pill, where the provider is a glyph
 *  rather than a generated face — the pill mirrors the mint selector, and the
 *  mint's icon comes from the mint, not from its name. */
export function ProviderPillIcon({
  status = 'unknown',
  size = 32,
}: {
  status?: ProviderStatus;
  size?: number;
}) {
  const accent = useThemeColor('accent');
  const dotStyle = useStatusDotStyle(status, size);

  return (
    <View className="relative">
      <Icon name="mdi:robot" size={size} color={accent} />
      {dotStyle ? <View className={DOT_CLASS} style={dotStyle} /> : null}
    </View>
  );
}
