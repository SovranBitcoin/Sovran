import { Skeleton } from 'heroui-native/skeleton';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image as RNImage, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { UntranslatedText } from '@/shared/ui/primitives/Text';

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

function getGradientTextColor(gradientColor: string): string {
  const match = gradientColor.match(/hsla?\((\d+)/i);
  if (!match) return 'rgba(17, 24, 39, 0.92)';

  const hue = Number(match[1]);
  return `hsla(${hue}, 34%, 14%, 0.92)`;
}

function getFallbackText(name: string | undefined, seed: string | undefined, size: number): string {
  if (name && name.trim().length > 0) {
    const cleaned = name.trim().replace(/[_-]+/g, ' ');
    if (size >= 52) {
      return cleaned.split(/\s+/)[0] ?? cleaned;
    }
    return cleaned
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }

  if (seed && seed.length > 0) {
    return seed.slice(0, 2).toUpperCase();
  }

  return '';
}

function FallbackContent({
  fallbackText,
  gradientTheme,
  gradientTextColor,
  fallbackIcon,
  borderRadius,
  size,
}: {
  fallbackText: string;
  gradientTheme: ReturnType<typeof generateSeededGradient>;
  gradientTextColor: string;
  fallbackIcon: string;
  borderRadius: number;
  size: number;
}) {
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        { borderRadius, justifyContent: 'center', alignItems: 'center' },
      ]}>
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
      {fallbackText ? (
        <UntranslatedText
          bold
          style={{ color: gradientTextColor }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.65}>
          {fallbackText}
        </UntranslatedText>
      ) : (
        <Icon name={fallbackIcon} size={Math.max(14, Math.round(size * 0.46))} color="#FFFFFF" />
      )}
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

  const fallbackText = getFallbackText(name, seed, size);
  const gradientTheme = useMemo(
    () => generateSeededGradient(`${seed ?? name ?? ''}`),
    [name, seed]
  );
  const gradientTextColor = useMemo(
    () => getGradientTextColor(gradientTheme.primaryColors[1]),
    [gradientTheme]
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

  const fallbackIcon = 'ph:user-bold';

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
    <FallbackContent
      fallbackText={fallbackText}
      gradientTheme={gradientTheme}
      gradientTextColor={gradientTextColor}
      fallbackIcon={fallbackIcon}
      borderRadius={borderRadius}
      size={size}
    />
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
        <RNImage
          source={{ uri: picture }}
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
        <RNImage source={{ uri: picture }} style={avatarStyle} accessibilityLabel={imageAlt} />
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
