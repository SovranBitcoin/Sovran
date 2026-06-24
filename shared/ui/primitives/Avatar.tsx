import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import BoringAvatar from '@mealection/react-native-boring-avatars';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import {
  AVATAR_FALLBACK_COLOR_TOKENS,
  FLAT_AVATAR_FALLBACK_ICON,
  FLAT_AVATAR_FALLBACK_VARIANT,
  GLASS_AVATAR_FALLBACK_VARIANT,
  WHITE_FACE_AVATAR_FALLBACK_VARIANT,
  getAvatarFallbackColorsForVariant,
  sanitizeAvatarFallbackSeed,
  type AvatarFallbackVariant,
} from '@/shared/lib/avatarFallback';
import { generateSeededGradient } from '@/shared/lib/avatarGradient';
import { prefetchImage } from '@/shared/lib/imageCache';
import { log } from '@/shared/lib/logger';
import {
  useVisualLayoutLogger,
  visualLayoutScopePart,
  type VisualLayoutConfig,
} from '@/shared/lib/contentShiftLog';
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
  visualScope?: string;
  visualKey?: string;
  visualSurface?: string;
  visualComponent?: string;
  visualPhase?: string;
  visualExtra?: VisualLayoutConfig['extra'];
  visualDisabled?: boolean;
}

type ImageStatus = 'loading' | 'loaded' | 'failed';

function GradientFallbackContent({
  fallbackSeed,
  borderRadius,
}: {
  fallbackSeed: string;
  borderRadius: number;
}) {
  const gradientTheme = generateSeededGradient(fallbackSeed);

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

function FlatFallbackContent({ borderRadius, size }: { borderRadius: number; size: number }) {
  // Mirror `MintIcon`'s missing-icon fallback: a single glyph in the background
  // color, centered on the muted surface color.
  const [muted, background] = useThemeColor(['muted', 'background'] as const);
  const iconSize = Math.round(size * 0.72);

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          borderRadius,
          overflow: 'hidden',
          backgroundColor: muted,
          alignItems: 'center',
          justifyContent: 'center',
        },
      ]}>
      <Icon name={FLAT_AVATAR_FALLBACK_ICON} size={iconSize} color={background} />
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

  if (fallbackVariant === FLAT_AVATAR_FALLBACK_VARIANT) {
    return <FlatFallbackContent borderRadius={borderRadius} size={size} />;
  }

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

// Every non-loading state renders this frame as its root via a plain `View`
// (the loading state uses a `View` too). Keeping the root element type identical
// across states means a fallback→image / image-loading→loaded transition is a
// child swap, NOT a remount — a remount forces a relayout that nudges neighbours
// a couple px ("padding-top"-like content shift when a pfp finishes loading).
// Do not switch any of these roots back to `VStack` (a different component type).
const avatarFrameStyle = { position: 'relative' as const, overflow: 'hidden' as const };
/** Fade duration (ms) for a profile picture loading in over its placeholder.
 *  expo-image skips this for memory-cached images, so recycled avatars stay
 *  instant — only a real network/disk load fades. */
const AVATAR_IMAGE_FADE_MS = 200;

let avatarLoadingVisualInstance = 0;

export const Avatar = ({
  state,
  picture,
  size = 48,
  alt,
  name,
  status,
  seed,
  fallbackVariant,
  visualScope = 'loading.avatar',
  visualKey,
  visualSurface = 'shared',
  visualComponent = 'AvatarLoading',
  visualPhase = 'loading',
  visualExtra,
  visualDisabled,
}: AvatarProps) => {
  const foreground = useThemeColor('foreground');
  // Match the skeleton fill used by `Text` — low-opacity foreground reads
  // as ambient "loading" rather than a solid silhouette.
  const loadingColor = opacity(foreground, 0.07);

  useEffect(() => {
    void prefetchImage(picture);
  }, [picture]);

  const [imageStatus, setImageStatus] = useState<ImageStatus>('loading');
  const [loadedPicture, setLoadedPicture] = useState<string | null>(null);

  useEffect(() => {
    setImageStatus('loading');
  }, [picture]);

  const handleImageLoad = () => {
    if (picture) setLoadedPicture(picture);
    setImageStatus('loaded');
  };
  const handleImageError = () => setImageStatus('failed');

  const borderRadius = size / 2;
  const statusIconSize = size * 0.33;
  const avatarStyle = useMemo(
    () => ({ width: size, height: size, borderRadius, overflow: 'hidden' as const }),
    [borderRadius, size]
  );
  const containerStyle = {
    ...avatarStyle,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  };

  const fallbackSeed = sanitizeAvatarFallbackSeed(seed ?? name ?? alt ?? 'avatar');

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

  const defaultAlt = 'Avatar';
  const imageAlt = alt || defaultAlt;
  const previousPicture = loadedPicture && loadedPicture !== picture ? loadedPicture : null;
  const pictureSource = { uri: picture };
  const previousPictureSource = previousPicture ? { uri: previousPicture } : null;
  const overlayImageStyle = [StyleSheet.absoluteFillObject, avatarStyle];
  const showsLoadingPlaceholder =
    state === 'loading' ||
    (state === 'image' && !!picture && imageStatus !== 'loaded' && !previousPicture);
  const visualInstanceKeyRef = React.useRef<string | null>(null);
  if (visualInstanceKeyRef.current === null) {
    avatarLoadingVisualInstance += 1;
    visualInstanceKeyRef.current = `avatar-loading:${avatarLoadingVisualInstance}`;
  }
  const visualLayout = useVisualLayoutLogger({
    enabled: visualDisabled !== true && showsLoadingPlaceholder,
    scope: visualScope,
    surface: visualSurface,
    component: visualComponent,
    itemKey: visualKey ? visualLayoutScopePart(visualKey) : visualInstanceKeyRef.current,
    itemType: 'avatar-loading',
    phase: visualPhase,
    extra: () => ({
      size,
      state,
      hasPicture: !!picture,
      hasStatus: !!status,
      hasPreviousPicture: !!previousPicture,
      ...(typeof visualExtra === 'function' ? visualExtra() : (visualExtra ?? {})),
    }),
  });
  const handleVisualLayout = (event: LayoutChangeEvent) => {
    visualLayout.onLayout(event);
  };

  // 1. Loading state — 50% foreground fill, no image, no gradient.
  if (state === 'loading') {
    return (
      <View
        ref={visualLayout.ref}
        collapsable={false}
        style={containerStyle}
        accessibilityRole="image"
        onLayout={handleVisualLayout}>
        <LoadingContent borderRadius={borderRadius} color={loadingColor} />
        {StatusBadgeWrapper}
      </View>
    );
  }

  // 2. Fallback state — selected fallback style.
  if (state === 'fallback') {
    return (
      <View style={avatarFrameStyle}>
        <View style={containerStyle} accessibilityRole="image" accessibilityLabel={imageAlt}>
          <AvatarFallbackContent
            fallbackSeed={fallbackSeed}
            borderRadius={borderRadius}
            size={size}
            variant={fallbackVariant}
          />
        </View>
        {StatusBadgeWrapper}
      </View>
    );
  }

  // 3. Image state — dev misuse without picture, fall back safely.
  if (!picture) {
    if (__DEV__) {
      log.warn('avatar.image_missing_picture');
    }
    return (
      <View style={avatarFrameStyle}>
        <View style={containerStyle} accessibilityRole="image" accessibilityLabel={imageAlt}>
          <AvatarFallbackContent
            fallbackSeed={fallbackSeed}
            borderRadius={borderRadius}
            size={size}
            variant={fallbackVariant}
          />
        </View>
        {StatusBadgeWrapper}
      </View>
    );
  }

  // 4. Image state — image failed to load → selected fallback style.
  if (imageStatus === 'failed') {
    return (
      <View style={avatarFrameStyle}>
        <View style={containerStyle} accessibilityRole="image" accessibilityLabel={imageAlt}>
          <AvatarFallbackContent
            fallbackSeed={fallbackSeed}
            borderRadius={borderRadius}
            size={size}
            variant={fallbackVariant}
          />
        </View>
        {StatusBadgeWrapper}
      </View>
    );
  }

  // 5. Image state — the picture fades in over a placeholder via expo-image's
  // native transition. The transition is skipped for memory-cached images, so it
  // only smooths a real load (network/disk) and never re-fades when an avatar
  // recycles back into view while scrolling. Behind it sits the previous decoded
  // image (while the URL is changing) or the loading fill, so the fade crossfades
  // from a placeholder rather than from empty space.
  return (
    <View
      ref={visualLayout.ref}
      collapsable={false}
      style={avatarFrameStyle}
      onLayout={handleVisualLayout}>
      {previousPicture ? (
        <ExpoImage
          source={previousPictureSource}
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
        source={pictureSource}
        cachePolicy="memory-disk"
        transition={AVATAR_IMAGE_FADE_MS}
        style={overlayImageStyle}
        accessibilityLabel={imageAlt}
        onLoad={handleImageLoad}
        onError={handleImageError}
      />
      {StatusBadgeWrapper}
    </View>
  );
};
