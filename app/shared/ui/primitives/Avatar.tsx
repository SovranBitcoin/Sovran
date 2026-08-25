import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { withAlpha } from '@/shared/lib/color';

import Icon from 'assets/icons';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { sanitizeAvatarFallbackSeed } from '@/shared/lib/avatarFallback';
import { prefetchImage } from '@/shared/lib/imageCache';
import { log } from '@/shared/lib/logger';
import {
  useVisualLayoutLogger,
  visualLayoutScopePart,
  type VisualLayoutConfig,
} from '@/shared/lib/contentShiftLog';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Badge } from './Badge';
import { zIndex } from '@/shared/styles/tokens';
import { ClaySilhouetteAvatar } from './ClaySilhouetteAvatar';

export type AvatarState = 'loading' | 'fallback' | 'image';

interface AvatarProps {
  state: AvatarState;
  picture?: string;
  size?: number;
  alt?: string;
  name?: string;
  status?: string;
  seed?: string;
  visualScope?: string;
  visualKey?: string;
  visualSurface?: string;
  visualComponent?: string;
  visualPhase?: string;
  visualExtra?: VisualLayoutConfig['extra'];
  visualDisabled?: boolean;
}

type ImageStatus = 'loading' | 'loaded' | 'failed';

function AvatarFallbackContent({
  fallbackSeed,
  borderRadius,
  size,
}: {
  fallbackSeed: string;
  borderRadius: number;
  size: number;
}) {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }]}>
      <ClaySilhouetteAvatar seed={fallbackSeed} size={size} />
    </View>
  );
}

function LoadingContent({ borderRadius, color }: { borderRadius: number; color: string }) {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius, backgroundColor: color }]}
    />
  );
}

// Every non-loading state renders this frame as its root via a plain `View`
// (the loading state uses a `View` too). Keeping the root element type identical
// across states means a fallback→image / image-loading→loaded transition is a
// child swap, NOT a remount — a remount forces a relayout that nudges neighbours
// a couple px ("padding-top"-like content shift when a pfp finishes loading).
// Do not switch any of these roots back to `VStack` (a different component type).
const avatarFrameStyle = { overflow: 'hidden' as const };
/** Fade duration (ms) for a profile picture loading in over its placeholder.
 *  expo-image skips this for memory-cached images, so recycled avatars stay
 *  instant — only a real network/disk load fades. */
const AVATAR_IMAGE_FADE_MS = 200;

const STATUS_BADGE_CONFIG: Record<
  string,
  { variant: 'success' | 'error' | 'secondary'; icon: string; badge: boolean }
> = {
  OK: { variant: 'success', icon: 'fluent:checkmark-16-filled', badge: true },
  ERROR: { variant: 'error', icon: 'nonicons:error-16', badge: true },
  OFFLINE: { variant: 'secondary', icon: 'feather:wifi', badge: true },
  VERIFIED: { variant: 'success', icon: 'material-symbols:verified-rounded', badge: false },
};

let avatarLoadingVisualInstance = 0;

export const Avatar = ({
  state,
  picture,
  size = 48,
  alt,
  name,
  status,
  seed,
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
  const loadingColor = withAlpha(foreground, 0.07);

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
  const avatarStyle = { width: size, height: size, borderRadius, overflow: 'hidden' as const };
  const containerStyle = {
    ...avatarStyle,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  };

  const fallbackSeed = sanitizeAvatarFallbackSeed(seed ?? name ?? alt ?? 'avatar');

  const statusBadge = status ? (STATUS_BADGE_CONFIG[status] ?? null) : null;

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
  const overlayImageStyle = [StyleSheet.absoluteFill, avatarStyle];
  const showsLoadingPlaceholder =
    state === 'loading' ||
    (state === 'image' && !!picture && imageStatus !== 'loaded' && !previousPicture);
  const visualInstanceKeyRef = useRef<string | null>(null);
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

  // 2/3/4. Every non-image outcome renders the same frame: an explicit
  // fallback state, dev misuse (image state with no picture), or a load that
  // failed. Only the middle case is a bug worth warning about.
  if (state === 'fallback' || !picture || imageStatus === 'failed') {
    if (__DEV__ && state !== 'fallback' && !picture) {
      log.warn('avatar.image_missing_picture');
    }
    return (
      <View style={avatarFrameStyle}>
        <View style={containerStyle} accessibilityRole="image" accessibilityLabel={imageAlt}>
          <AvatarFallbackContent
            fallbackSeed={fallbackSeed}
            borderRadius={borderRadius}
            size={size}
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
