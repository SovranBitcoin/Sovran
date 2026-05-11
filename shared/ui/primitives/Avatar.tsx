import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { generateSeededGradient } from '@/shared/lib/avatarGradient';
import { prefetchImage } from '@/shared/lib/imageCache';
import { log } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Badge } from './Badge';
import { zIndex } from '@/shared/styles/tokens';

export type AvatarState = 'loading' | 'fallback' | 'image';

interface AvatarProps {
  state: AvatarState;
  picture?: string;
  size?: number;
  alt?: string;
  name?: string;
  status?: string;
  seed?: string;
}

type ImageStatus = 'loading' | 'loaded' | 'failed';

function FallbackContent({
  gradientTheme,
  borderRadius,
}: {
  gradientTheme: ReturnType<typeof generateSeededGradient>;
  borderRadius: number;
}) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { borderRadius }]}>
      <LinearGradient
        colors={gradientTheme.primaryColors}
        start={gradientTheme.primaryStart}
        end={gradientTheme.primaryEnd}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={gradientTheme.overlayColors}
        start={gradientTheme.overlayStart}
        end={gradientTheme.overlayEnd}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

function LoadingContent({ borderRadius, color }: { borderRadius: number; color: string }) {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { borderRadius, backgroundColor: color }]}
    />
  );
}

export const Avatar = ({ state, picture, size = 48, alt, name, status, seed }: AvatarProps) => {
  const foreground = useThemeColor('foreground');
  // Match the skeleton fill used by `Text` — low-opacity foreground reads
  // as ambient "loading" rather than a solid silhouette.
  const loadingColor = useMemo(() => opacity(foreground, 0.15), [foreground]);

  useEffect(() => {
    void prefetchImage(picture);
  }, [picture]);

  const [imageStatus, setImageStatus] = useState<ImageStatus>('loading');

  useEffect(() => {
    setImageStatus('loading');
  }, [picture]);

  const handleImageLoad = useCallback(() => setImageStatus('loaded'), []);
  const handleImageError = useCallback(() => setImageStatus('failed'), []);

  const borderRadius = size / 2;
  const statusIconSize = size * 0.33;
  const avatarStyle = { width: size, height: size, borderRadius, overflow: 'hidden' } as const;

  const gradientTheme = useMemo(
    () => generateSeededGradient(`${seed ?? name ?? ''}`),
    [name, seed]
  );

  const statusBadge = useMemo(() => {
    if (!status) return null;
    const statusConfig: Record<
      string,
      { variant: 'success' | 'error' | 'secondary'; icon: string; badge: boolean }
    > = {
      OK: { variant: 'success', icon: 'fluent:checkmark-16-filled', badge: true },
      ERROR: { variant: 'error', icon: 'nonicons:error-16', badge: true },
      OFFLINE: { variant: 'secondary', icon: 'feather:wifi', badge: true },
      VERIFIED: { variant: 'success', icon: 'material-symbols:verified-rounded', badge: false },
    };
    return statusConfig[status] ?? null;
  }, [status]);

  const StatusBadgeWrapper = statusBadge ? (
    <VStack
      style={{
        position: 'absolute',
        bottom: -2,
        right: -2,
        zIndex: zIndex.dropdown,
      }}>
      {statusBadge.badge ? (
        <Badge variant={statusBadge.variant} icon={statusBadge.icon} size={statusIconSize} />
      ) : (
        <Icon name={statusBadge.icon} size={statusIconSize} />
      )}
    </VStack>
  ) : null;

  const containerStyle = {
    ...avatarStyle,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  };

  const defaultAlt = 'Avatar';
  const imageAlt = alt || defaultAlt;

  // 1. Loading state — 50% foreground fill, no image, no gradient.
  if (state === 'loading') {
    return (
      <View style={containerStyle} accessibilityRole="image">
        <LoadingContent borderRadius={borderRadius} color={loadingColor} />
        {StatusBadgeWrapper}
      </View>
    );
  }

  // 2. Fallback state — seeded gradient.
  if (state === 'fallback') {
    return (
      <VStack style={{ position: 'relative', overflow: 'hidden' }}>
        <View style={containerStyle} accessibilityRole="image" accessibilityLabel={imageAlt}>
          <FallbackContent gradientTheme={gradientTheme} borderRadius={borderRadius} />
        </View>
        {StatusBadgeWrapper}
      </VStack>
    );
  }

  // 3. Image state — dev misuse without picture, fall back safely.
  if (!picture) {
    if (__DEV__) {
      log.warn('avatar.image_missing_picture');
    }
    return (
      <VStack style={{ position: 'relative', overflow: 'hidden' }}>
        <View style={containerStyle} accessibilityRole="image" accessibilityLabel={imageAlt}>
          <FallbackContent gradientTheme={gradientTheme} borderRadius={borderRadius} />
        </View>
        {StatusBadgeWrapper}
      </VStack>
    );
  }

  // 4. Image state — image failed to load → gradient fallback.
  if (imageStatus === 'failed') {
    return (
      <VStack style={{ position: 'relative', overflow: 'hidden' }}>
        <View style={containerStyle} accessibilityRole="image" accessibilityLabel={imageAlt}>
          <FallbackContent gradientTheme={gradientTheme} borderRadius={borderRadius} />
        </View>
        {StatusBadgeWrapper}
      </VStack>
    );
  }

  // 5. Image state — image still loading → show loading state with invisible image underneath.
  if (imageStatus !== 'loaded') {
    return (
      <View style={{ position: 'relative', overflow: 'hidden' }}>
        <View style={containerStyle}>
          <LoadingContent borderRadius={borderRadius} color={loadingColor} />
        </View>
        <ExpoImage
          source={{ uri: picture }}
          cachePolicy="memory-disk"
          style={[StyleSheet.absoluteFillObject, avatarStyle, { opacity: 0 }]}
          accessibilityLabel={imageAlt}
          onLoad={handleImageLoad}
          onError={handleImageError}
        />
        {StatusBadgeWrapper}
      </View>
    );
  }

  // 6. Image state — loaded → show the image.
  return (
    <VStack style={{ position: 'relative', overflow: 'hidden' }}>
      <ExpoImage
        source={{ uri: picture }}
        cachePolicy="memory-disk"
        style={avatarStyle}
        accessibilityLabel={imageAlt}
        onError={handleImageError}
      />
      {StatusBadgeWrapper}
    </VStack>
  );
};
