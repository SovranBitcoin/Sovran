import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import BoringAvatar from '@mealection/react-native-boring-avatars';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import {
  AVATAR_FALLBACK_COLOR_TOKENS,
  GLASS_AVATAR_FALLBACK_VARIANT,
  WHITE_FACE_AVATAR_FALLBACK_VARIANT,
  getAvatarFallbackColorsForVariant,
  sanitizeAvatarFallbackSeed,
  type AvatarFallbackVariant,
} from '@/shared/lib/avatarFallback';
import { generateSeededGradient } from '@/shared/lib/avatarGradient';
import { prefetchImage } from '@/shared/lib/imageCache';
import { log } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { Badge } from './Badge';
import { zIndex } from '@/shared/styles/tokens';
import { WhiteFaceBeamAvatar } from './WhiteFaceBeamAvatar';

export type AvatarState = 'loading' | 'fallback' | 'image';

interface AvatarProps {
  state: AvatarState;
  picture?: string;
  size?: number;
  alt?: string;
  name?: string;
  status?: string;
  seed?: string;
  /** Preview override. Normal app avatars read the persisted Settings value. */
  fallbackVariant?: AvatarFallbackVariant;
}

type ImageStatus = 'loading' | 'loaded' | 'failed';

function GradientFallbackContent({
  fallbackSeed,
  borderRadius,
}: {
  fallbackSeed: string;
  borderRadius: number;
}) {
  const gradientTheme = useMemo(() => generateSeededGradient(fallbackSeed), [fallbackSeed]);

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { borderRadius, overflow: 'hidden' }]}>
      <LinearGradient
        colors={gradientTheme.primaryColors}
        start={gradientTheme.primaryStart}
        end={gradientTheme.primaryEnd}
        style={StyleSheet.absoluteFill}
        testID="avatar-glass-gradient-primary"
      />
      <LinearGradient
        colors={gradientTheme.overlayColors}
        start={gradientTheme.overlayStart}
        end={gradientTheme.overlayEnd}
        style={StyleSheet.absoluteFill}
        testID="avatar-glass-gradient-overlay"
      />
    </View>
  );
}

function AvatarFallbackContent({
  fallbackSeed,
  borderRadius,
  size,
  variant,
}: {
  fallbackSeed: string;
  borderRadius: number;
  size: number;
  variant?: AvatarFallbackVariant;
}) {
  const storedVariant = useSettingsStore((state) => state.avatarFallbackVariant);
  const fallbackVariant = variant ?? storedVariant;
  const fallbackColors = useThemeColor(AVATAR_FALLBACK_COLOR_TOKENS);
  const variantColors = getAvatarFallbackColorsForVariant({
    variant: fallbackVariant,
    colors: fallbackColors,
    seed: fallbackSeed,
  });

  if (fallbackVariant === GLASS_AVATAR_FALLBACK_VARIANT) {
    return <GradientFallbackContent fallbackSeed={fallbackSeed} borderRadius={borderRadius} />;
  }

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { borderRadius, overflow: 'hidden' }]}>
      {fallbackVariant === WHITE_FACE_AVATAR_FALLBACK_VARIANT ? (
        <WhiteFaceBeamAvatar name={fallbackSeed} size={size} colors={variantColors} />
      ) : (
        <BoringAvatar
          name={fallbackSeed}
          size={size}
          variant={fallbackVariant}
          colors={variantColors}
        />
      )}
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

export const Avatar = ({
  state,
  picture,
  size = 48,
  alt,
  name,
  status,
  seed,
  fallbackVariant,
}: AvatarProps) => {
  const foreground = useThemeColor('foreground');
  // Match the skeleton fill used by `Text` — low-opacity foreground reads
  // as ambient "loading" rather than a solid silhouette.
  const loadingColor = useMemo(() => opacity(foreground, 0.07), [foreground]);

  useEffect(() => {
    void prefetchImage(picture);
  }, [picture]);

  const [imageStatus, setImageStatus] = useState<ImageStatus>('loading');
  const [loadedPicture, setLoadedPicture] = useState<string | null>(null);

  useEffect(() => {
    setImageStatus('loading');
  }, [picture]);

  const handleImageLoad = useCallback(() => {
    if (picture) setLoadedPicture(picture);
    setImageStatus('loaded');
  }, [picture]);
  const handleImageError = useCallback(() => setImageStatus('failed'), []);

  const borderRadius = size / 2;
  const statusIconSize = size * 0.33;
  const avatarStyle = { width: size, height: size, borderRadius, overflow: 'hidden' } as const;

  const fallbackSeed = useMemo(
    () => sanitizeAvatarFallbackSeed(seed ?? name ?? alt ?? 'avatar'),
    [alt, name, seed]
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

  // 2. Fallback state — selected fallback style.
  if (state === 'fallback') {
    return (
      <VStack style={{ position: 'relative', overflow: 'hidden' }}>
        <View style={containerStyle} accessibilityRole="image" accessibilityLabel={imageAlt}>
          <AvatarFallbackContent
            fallbackSeed={fallbackSeed}
            borderRadius={borderRadius}
            size={size}
            variant={fallbackVariant}
          />
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
          <AvatarFallbackContent
            fallbackSeed={fallbackSeed}
            borderRadius={borderRadius}
            size={size}
            variant={fallbackVariant}
          />
        </View>
        {StatusBadgeWrapper}
      </VStack>
    );
  }

  // 4. Image state — image failed to load → selected fallback style.
  if (imageStatus === 'failed') {
    return (
      <VStack style={{ position: 'relative', overflow: 'hidden' }}>
        <View style={containerStyle} accessibilityRole="image" accessibilityLabel={imageAlt}>
          <AvatarFallbackContent
            fallbackSeed={fallbackSeed}
            borderRadius={borderRadius}
            size={size}
            variant={fallbackVariant}
          />
        </View>
        {StatusBadgeWrapper}
      </VStack>
    );
  }

  // 5. Image state — image still loading. Keep the previous decoded image in
  // place while the next URL warms, avoiding a fallback/loading flash when a
  // profile picture changes during a transition.
  if (imageStatus !== 'loaded') {
    const previousPicture = loadedPicture && loadedPicture !== picture ? loadedPicture : null;
    return (
      <View style={{ position: 'relative', overflow: 'hidden' }}>
        {previousPicture ? (
          <ExpoImage
            source={{ uri: previousPicture }}
            cachePolicy="memory-disk"
            style={avatarStyle}
            accessibilityLabel={imageAlt}
          />
        ) : (
          <View style={containerStyle}>
            <LoadingContent borderRadius={borderRadius} color={loadingColor} />
          </View>
        )}
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
