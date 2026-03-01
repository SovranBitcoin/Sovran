import { Avatar as HeroAvatar } from 'heroui-native/avatar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { UntranslatedText } from 'components/ui/Text';

import Icon from 'assets/icons';
import { VStack } from 'components/ui/View/VStack';
import { generateSeededGradient } from '@/helper/avatarGradient';
import { prefetchImage } from '@/helper/imageCache';
import { Badge } from './Badge';
import { Skeleton } from './Skeleton';

type AvatarVariant = 'person' | 'mint';

interface AvatarProps {
  picture?: string;
  size?: number;
  variant?: AvatarVariant;
  alt?: string;
  name?: string;
  status?: string;
  seed?: string;
  loading?: boolean;
}

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

export const Avatar = ({
  picture,
  size = 48,
  variant = 'person',
  alt,
  name,
  status,
  seed,
  loading = false,
}: AvatarProps) => {
  useEffect(() => {
    prefetchImage(picture);
  }, [picture]);

  // Track whether the current picture has finished loading (or erroring).
  // Resets synchronously when the picture URL changes so the skeleton
  // persists seamlessly across metadata-loading → image-loading.
  const [imageSettled, setImageSettled] = useState(!picture);
  const prevPicRef = useRef(picture);
  if (picture !== prevPicRef.current) {
    prevPicRef.current = picture;
    setImageSettled(!picture);
  }

  const handleImageSettled = useCallback(() => setImageSettled(true), []);

  const showSkeleton = loading || !imageSettled;

  const borderRadius = variant === 'person' ? size / 2 : Math.round(size * 0.25);
  const statusIconSize = size * 0.33;
  const avatarStyle = { width: size, height: size, borderRadius, overflow: 'hidden' } as const;

  const fallbackText = getFallbackText(name, seed, size);
  const gradientTheme = useMemo(
    () => generateSeededGradient(`${seed ?? name ?? ''}:${variant}`, variant),
    [name, seed, variant]
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

  const fallbackIcon = variant === 'person' ? 'ph:user-bold' : 'majesticons:coins';
  const defaultAlt = variant === 'person' ? 'User Avatar' : 'Mint Avatar';

  return (
    <VStack style={{ position: 'relative' }}>
      <HeroAvatar
        alt={alt || defaultAlt}
        variant="soft"
        color="accent"
        animation={showSkeleton ? 'disable-all' : undefined}
        style={avatarStyle}>
        {picture ? (
          <HeroAvatar.Image
            source={{ uri: picture }}
            style={avatarStyle}
            onLoadEnd={handleImageSettled}
          />
        ) : null}
        <HeroAvatar.Fallback
          delayMs={0}
          styles={{
            container: {
              ...avatarStyle,
              justifyContent: 'center',
              alignItems: 'center',
            },
            text: {
              color: '#FFFFFF',
              fontWeight: '700',
              fontSize:
                fallbackText.length >= 8
                  ? Math.max(10, Math.round(size * 0.2))
                  : Math.max(12, Math.round(size * 0.34)),
              letterSpacing: 0.25,
            },
          }}>
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
          {fallbackText ? (
            <UntranslatedText
              bold
              style={{
                color: gradientTextColor,
              }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.65}>
              {fallbackText}
            </UntranslatedText>
          ) : (
            <Icon
              name={fallbackIcon}
              size={Math.max(14, Math.round(size * 0.46))}
              color="#FFFFFF"
            />
          )}
        </HeroAvatar.Fallback>
      </HeroAvatar>

      {showSkeleton ? (
        <Skeleton
          style={{
            ...avatarStyle,
            position: 'absolute',
            zIndex: 10,
          }}
        />
      ) : null}

      {statusBadge ? (
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
      ) : null}
    </VStack>
  );
};
