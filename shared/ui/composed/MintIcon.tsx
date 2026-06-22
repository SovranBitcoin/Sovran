import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image as ExpoImage } from 'expo-image';
import opacity from 'hex-color-opacity';
import { StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';

import Icon from '@/assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { prefetchImage } from '@/shared/lib/imageCache';

const MINT_DEFAULT_ICON = 'mingcute:bank-fill';

// Mirrors `AVATAR_IMAGE_FADE_MS`: a real network/disk load fades the icon in
// over its placeholder rather than popping. expo-image skips the transition for
// memory-cached images, so a recycled icon stays put. This is independent of any
// parent skeleton→content crossfade — the icon never blocks the data swap.
const MINT_ICON_IMAGE_FADE_MS = 200;

interface MintIconProps {
  iconUrl?: string | null;
  name?: string | null;
  alt?: string;
  size?: number;
  isLoading?: boolean;
  style?: StyleProp<ViewStyle>;
}

function normalizeIconUrl(iconUrl: string | null | undefined): string | undefined {
  const trimmed = iconUrl?.trim();
  return trimmed ? trimmed : undefined;
}

export function MintIcon({
  iconUrl,
  name,
  alt,
  size = 44,
  isLoading = false,
  style,
}: MintIconProps) {
  const [foreground, background, muted] = useThemeColor([
    'foreground',
    'background',
    'muted',
  ] as const);
  const normalizedIconUrl = normalizeIconUrl(iconUrl);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    void prefetchImage(normalizedIconUrl);
  }, [normalizedIconUrl]);

  useEffect(() => {
    setFailedUrl(null);
  }, [normalizedIconUrl]);

  const loadingColor = useMemo(() => opacity(foreground, 0.07), [foreground]);
  const fallbackBackground = muted;
  const borderRadius = size / 2;
  const imageAlt = alt ?? `${name || 'Mint'} icon`;
  const iconSize = Math.round(size * 0.72);

  const containerStyle = useMemo(
    () => [
      styles.container,
      {
        width: size,
        height: size,
        borderRadius,
        backgroundColor: isLoading ? loadingColor : fallbackBackground,
      },
      style,
    ],
    [borderRadius, fallbackBackground, isLoading, loadingColor, size, style]
  );
  const imageSource = useMemo(
    () => (normalizedIconUrl ? { uri: normalizedIconUrl } : undefined),
    [normalizedIconUrl]
  );
  const handleImageError = useCallback(() => {
    if (normalizedIconUrl) {
      setFailedUrl(normalizedIconUrl);
    }
  }, [normalizedIconUrl]);

  if (isLoading) {
    return <View style={containerStyle} accessibilityRole="image" accessibilityLabel={imageAlt} />;
  }

  if (normalizedIconUrl && failedUrl !== normalizedIconUrl) {
    return (
      <View style={containerStyle} accessibilityRole="image" accessibilityLabel={imageAlt}>
        <ExpoImage
          source={imageSource}
          cachePolicy="memory-disk"
          contentFit="cover"
          transition={MINT_ICON_IMAGE_FADE_MS}
          style={StyleSheet.absoluteFill}
          accessibilityLabel={imageAlt}
          onError={handleImageError}
        />
      </View>
    );
  }

  return (
    <View style={containerStyle} accessibilityRole="image" accessibilityLabel={imageAlt}>
      <Icon name={MINT_DEFAULT_ICON} size={iconSize} color={background} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
