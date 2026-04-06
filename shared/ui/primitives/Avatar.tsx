import { Skeleton } from 'heroui-native/skeleton';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import Icon from 'assets/icons';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { generateSeededGradient } from '@/shared/lib/avatarGradient';
import { prefetchImage } from '@/shared/lib/imageCache';
import { Badge } from './Badge';

interface AvatarProps {
  picture?: string;
  size?: number;
  alt?: string;
  name?: string;
  status?: string;
  seed?: string;
  loading?: boolean;
}

type ImageStatus = 'idle' | 'loading' | 'loaded' | 'failed';

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

export const Avatar = ({
  picture,
  size = 48,
  alt,
  name,
  status,
  seed,
  loading = false,
}: AvatarProps) => {
  useEffect(() => {
    prefetchImage(picture);
  }, [picture]);

  const [imageStatus, setImageStatus] = useState<ImageStatus>(() => (picture ? 'loading' : 'idle'));

  useEffect(() => {
    setImageStatus(picture ? 'loading' : 'idle');
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

  const showSkeleton =
    loading || (!!picture && imageStatus !== 'loaded' && imageStatus !== 'failed');
  const hasPicture = !!picture;

  const StatusBadgeWrapper = statusBadge ? (
    <VStack
      style={{
        position: 'absolute',
        bottom: -2,
        right: -2,
        zIndex: 50,
      }}>
      {statusBadge.badge ? (
        <Badge variant={statusBadge.variant} icon={statusBadge.icon} size={statusIconSize} />
      ) : (
        <Icon name={statusBadge.icon} size={statusIconSize} />
      )}
    </VStack>
  ) : null;

  const fallbackContainerStyle = {
    ...avatarStyle,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  };

  const fallbackContent = (
    <FallbackContent gradientTheme={gradientTheme} borderRadius={borderRadius} />
  );

  const SkeletonOverlay = (
    <Skeleton
      isLoading
      className="bg-skeleton rounded-full"
      style={[StyleSheet.absoluteFillObject, avatarStyle]}
    />
  );

  // 1. Skeleton only — parent loading and no picture yet (nothing to load)
  if (loading && !hasPicture) {
    return (
      <VStack style={{ position: 'relative', overflow: 'hidden' }}>
        <Skeleton isLoading className="bg-skeleton rounded-full" style={avatarStyle} />
        {StatusBadgeWrapper}
      </VStack>
    );
  }

  const defaultAlt = 'Avatar';
  const imageAlt = alt || defaultAlt;

  // 2. Picture loading — skeleton + hidden Image. Never render HeroAvatar here so we avoid
  //    its initial status='error' which would flash the fallback for one frame.
  if (hasPicture && showSkeleton) {
    return (
      <VStack style={{ position: 'relative', overflow: 'hidden' }}>
        <ExpoImage
          source={{ uri: picture }}
          cachePolicy="memory-disk"
          style={[avatarStyle, { opacity: 0 }]}
          accessibilityLabel={imageAlt}
          onLoad={handleImageLoad}
          onError={handleImageError}
        />
        {SkeletonOverlay}
        {StatusBadgeWrapper}
      </VStack>
    );
  }

  // 3. Image loaded — show the image
  if (hasPicture && imageStatus === 'loaded') {
    return (
      <VStack style={{ position: 'relative', overflow: 'hidden' }}>
        <ExpoImage source={{ uri: picture }} cachePolicy="memory-disk" style={avatarStyle} accessibilityLabel={imageAlt} />
        {StatusBadgeWrapper}
      </VStack>
    );
  }

  // 4. Fallback — no picture or image failed to load
  return (
    <VStack style={{ position: 'relative', overflow: 'hidden' }}>
      <View style={fallbackContainerStyle} accessibilityRole="image" accessibilityLabel={imageAlt}>
        {fallbackContent}
      </View>
      {StatusBadgeWrapper}
    </VStack>
  );
};
