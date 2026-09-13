import { useEffect, useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { withAlpha } from '@/shared/lib/color';

import Icon from '@/assets/icons';
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
import { spacing } from '@/shared/styles/tokens';
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
const avatarFrameStyle = { overflow: 'visible' as const };
/** Fade duration (ms) for a profile picture loading in over its placeholder.
 *  expo-image skips this for memory-cached images, so recycled avatars stay
 *  instant — only a real network/disk load fades. */
const AVATAR_IMAGE_FADE_MS = 200;

type AvatarStatus = 'OK' | 'ERROR' | 'OFFLINE';

const STATUS_DOT_BY_STATUS = {
  OK: {
    className: 'bg-success',
    icon: 'fluent:checkmark-16-filled',
    iconColor: 'success-foreground',
    label: 'OK',
  },
  ERROR: {
    className: 'bg-danger',
    icon: 'mdi:alert-circle',
    iconColor: 'danger-foreground',
    label: 'Error',
  },
  OFFLINE: {
    className: 'bg-muted',
    icon: 'feather:wifi-off',
    iconColor: 'background',
    label: 'Offline',
  },
} as const satisfies Record<
  AvatarStatus,
  {
    className: string;
    icon: string;
    iconColor: 'success-foreground' | 'danger-foreground' | 'background';
    label: string;
  }
>;

export function AvatarStatusDot({ status, size }: { status?: string; size: number }) {
  const dot =
    status === 'OK' || status === 'ERROR' || status === 'OFFLINE'
      ? STATUS_DOT_BY_STATUS[status]
      : null;
  const iconColor = useThemeColor(dot?.iconColor ?? 'foreground');
  if (!dot) return null;

  // Preserve the mint header's icon padding and 4-point page-colored ring.
  // Borders paint inside the box, so reserve both sides outside the disc.
  const outerSize = size + spacing.xs * 3;

  return (
    <View
      testID="avatar-status-dot"
      accessibilityRole="image"
      accessibilityLabel={dot.label}
      className={`border-surface items-center justify-center rounded-full border-4 ${dot.className}`}
      style={{ width: outerSize, height: outerSize }}>
      <Icon name={dot.icon} size={size} color={iconColor} />
    </View>
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

  const StatusBadgeWrapper = status ? (
    <VStack className="z-100 absolute -bottom-0.5 -right-0.5">
      {status === 'VERIFIED' ? (
        <Icon name="material-symbols:verified-rounded" size={statusIconSize} />
      ) : (
        <AvatarStatusDot status={status} size={statusIconSize} />
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
  // Per-instance key via useId — the previous module-counter + lazy-ref-init
  // pattern was a render side effect the React Compiler refuses to compile
  // (the whole component rendered unmemoized).
  const visualInstanceKey = `avatar-loading:${useId()}`;
  const visualLayout = useVisualLayoutLogger({
    enabled: visualDisabled !== true && showsLoadingPlaceholder,
    scope: visualScope,
    surface: visualSurface,
    component: visualComponent,
    itemKey: visualKey ? visualLayoutScopePart(visualKey) : visualInstanceKey,
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
  // Destructured to a `*Ref` binding: the compiler can't tell that a `.ref`
  // property read in JSX is a ref OBJECT (not a ref VALUE) and skips the
  // whole component ("Cannot access refs during render") when passed inline.
  // Both are `undefined` in a release build, so the view attaches no ref and
  // dispatches no layout event for measurement that cannot run.
  const { ref: visualHostRef, onLayout: reportVisualLayout } = visualLayout;

  // 1. Loading state — 50% foreground fill, no image, no gradient.
  if (state === 'loading') {
    return (
      <View
        ref={visualHostRef}
        collapsable={false}
        style={[containerStyle, avatarFrameStyle]}
        accessibilityRole="image"
        onLayout={reportVisualLayout}>
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
      ref={visualHostRef}
      collapsable={false}
      style={avatarFrameStyle}
      onLayout={reportVisualLayout}>
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
