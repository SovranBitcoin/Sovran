import { useMemo } from 'react';
import { View } from 'react-native';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';

import type { ProviderStatus } from '@/shared/lib/routstr/providerHealth';

/**
 * A provider's face in the picker, with a liveness dot on its corner.
 *
 * Routstr nodes publish a name and a description but no icon, so this builds
 * one: the initial on a colour derived from the host. Deterministic on
 * purpose — the same provider looks the same on every launch and every
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

/** Hue from the host, so the colour is a property of the provider rather than
 *  of its position in a list that reorders. */
function hueFor(baseUrl: string): number {
  let hash = 0;
  for (let i = 0; i < baseUrl.length; i++) hash = (hash * 31 + baseUrl.charCodeAt(i)) % 360;
  return hash;
}

function initialFor(name: string, baseUrl: string): string {
  const source = name.trim() || baseUrl.replace(/^https:\/\//, '');
  const letter = source.match(/[\p{L}\p{N}]/u)?.[0];
  return (letter ?? '?').toUpperCase();
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
  const background = useThemeColor('background');
  const dotStyle = useStatusDotStyle(status, size);
  const hue = useMemo(() => hueFor(baseUrl), [baseUrl]);

  const circleStyle = useMemo(
    () => ({
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: `hsl(${hue}, 45%, 45%)`,
    }),
    [hue, size]
  );

  return (
    <View className="relative" accessibilityLabel={`${name || baseUrl} provider`}>
      <View className="items-center justify-center overflow-hidden" style={circleStyle}>
        <Text size={Math.round(size * 0.44)} bold color={background}>
          {initialFor(name, baseUrl)}
        </Text>
      </View>
      {dotStyle ? <View className={DOT_CLASS} style={dotStyle} /> : null}
    </View>
  );
}

/** The same badge on the tab header's pill, where the provider is a glyph
 *  rather than an initial — the pill mirrors the mint selector, and the mint's
 *  icon comes from the mint, not from its name. */
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
