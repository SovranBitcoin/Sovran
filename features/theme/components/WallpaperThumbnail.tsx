/**
 * WallpaperThumbnail — compact tappable preview of a single wallpaper theme.
 *
 * Accepts any theme name from the catalog or the synthetic Colors album.
 * Renders either the downloaded local image, the remote thumb URL, or a
 * gradient derived from the palette when no image asset is available.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { PressableFeedback } from 'heroui-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from '@/shared/ui/primitives/Image';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import Icon from 'assets/icons';
import { THEMES } from '@/themes';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import type { WallpaperCatalogEntry } from '@/shared/stores/global/wallpaperStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log } from '@/shared/lib/logger';
import { describeImageLoadError } from '@/shared/lib/imageLoadError';

/** A thumbUrl is only usable if it's a real http(s) URL — empty strings,
 *  whitespace, or junk like "null" must fall through to the gradient rather
 *  than render a blank `<Image>`. */
function isLikelyImageUrl(url: string | undefined | null): url is string {
  return typeof url === 'string' && /^https?:\/\/\S+/i.test(url.trim());
}

interface WallpaperThumbnailProps {
  themeName: string;
  entry?: WallpaperCatalogEntry;
  selected?: boolean;
  onPress?: () => void;
  width: number;
  height: number;
  showPlayBadge?: boolean;
}

export const WallpaperThumbnail = React.memo(function WallpaperThumbnail({
  themeName,
  entry,
  selected,
  onPress,
  width,
  height,
  showPlayBadge,
}: WallpaperThumbnailProps) {
  const downloaded = useWallpaperStore((s) => s.downloaded[themeName]);
  const activeDownloadProgress = useWallpaperStore((s) => s.activeDownloads[themeName]);
  const paletteColors = THEMES[themeName as keyof typeof THEMES] as
    | Record<string, string>
    | undefined;
  // Selection border tracks the wallet's active theme so the picker
  // reflects the user's choice instead of a hardcoded blue.
  const foreground = useThemeColor('foreground');

  // Track the source that failed to load so we fall back to the palette
  // gradient instead of a blank box. Keyed by URI (not a boolean) so a
  // recycled list row with a *different* thumb retries instead of staying
  // blank.
  const [failedUri, setFailedUri] = useState<string | null>(null);

  const rawThumbUrl = entry?.thumbUrl;
  const downloadedLocalUri = downloaded?.localUri;
  const hasEntry = !!entry;
  const hasDownloaded = !!downloaded;
  const hasPalette = !!paletteColors;
  const remoteThumb = isLikelyImageUrl(rawThumbUrl) ? rawThumbUrl.trim() : undefined;
  const sourceUri = downloadedLocalUri ?? remoteThumb;
  const imageSource = sourceUri && sourceUri !== failedUri ? { uri: sourceUri } : null;
  const hasImageSource = !!imageSource;
  const sourceKind = hasDownloaded
    ? 'downloaded-file'
    : remoteThumb
      ? 'remote-thumb'
      : hasPalette
        ? 'palette-gradient'
        : 'solid-fallback';

  useEffect(() => {
    if (rawThumbUrl?.trim() && !remoteThumb) {
      log.warn('wallpaper.thumb.invalid_url', { themeName, thumbUrl: rawThumbUrl });
    }
    if (!hasImageSource) {
      log.debug('wallpaper.thumb.fallback', {
        themeName,
        sourceKind,
        hasEntry,
        hasDownloaded,
        hasPalette,
        failedUri,
      });
    }
  }, [
    failedUri,
    hasDownloaded,
    hasEntry,
    hasImageSource,
    hasPalette,
    rawThumbUrl,
    remoteThumb,
    sourceKind,
    themeName,
  ]);

  const inProgress = activeDownloadProgress !== undefined && activeDownloadProgress < 1;

  return (
    <PressableFeedback
      onPress={onPress}
      isDisabled={!onPress || inProgress}
      animation={false}
      style={{ width, height }}>
      <PressableFeedback.Scale>
        <View
          className="overflow-hidden rounded-2xl bg-[#1a1a1a]"
          style={[{ width, height }, selected && { borderWidth: 2, borderColor: foreground }]}>
          {imageSource ? (
            <Image
              source={imageSource}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              onLoad={() => {
                log.info('wallpaper.thumb.loaded', { themeName, sourceKind, sourceUri });
              }}
              onError={(event) => {
                log.warn('wallpaper.thumb.load_failed', {
                  themeName,
                  sourceKind,
                  sourceUri,
                  error: describeImageLoadError(event),
                });
                if (sourceUri) setFailedUri(sourceUri);
              }}
            />
          ) : paletteColors ? (
            <LinearGradient
              colors={[
                paletteColors['800'] || '#1a1a1a',
                paletteColors['900'] || '#0d0d0d',
                paletteColors['950'] || '#000000',
              ]}
              style={StyleSheet.absoluteFillObject}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#1a1a1a' }]} />
          )}

          {inProgress && (
            <View className="absolute inset-0 items-center justify-center bg-black/60">
              <Text size={14} bold style={{ color: '#fff' }}>
                {Math.round((activeDownloadProgress ?? 0) * 100)}%
              </Text>
            </View>
          )}

          {showPlayBadge && !inProgress && (
            <View className="absolute bottom-2 right-2 h-7 w-7 items-center justify-center rounded-[14px] bg-black/55">
              <Icon name="mdi:play" size={16} color="#fff" />
            </View>
          )}

          {!downloaded && entry && !inProgress && (
            <View className="absolute right-2 top-2 h-6 w-6 items-center justify-center rounded-xl bg-black/50">
              <Icon name="mdi:cloud-download-outline" size={12} color="#fff" />
            </View>
          )}
        </View>
      </PressableFeedback.Scale>
    </PressableFeedback>
  );
});
