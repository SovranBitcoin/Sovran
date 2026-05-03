/**
 * WallpaperThumbnail — compact tappable preview of a single wallpaper theme.
 *
 * Accepts any theme name from the catalog or the synthetic Colors album.
 * Renders either the downloaded local image, the remote thumb URL, or a
 * gradient derived from the palette when no image asset is available.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { PressableFeedback } from 'heroui-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from '@/shared/ui/primitives/Image';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import Icon from 'assets/icons';
import { THEMES } from '@/shared/providers/ThemeProvider';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import type { WallpaperCatalogEntry } from '@/shared/stores/global/wallpaperStore';

export interface WallpaperThumbnailProps {
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

  const imageSource = downloaded
    ? { uri: downloaded.localUri }
    : entry?.thumbUrl
    ? { uri: entry.thumbUrl }
    : null;

  const inProgress =
    activeDownloadProgress !== undefined && activeDownloadProgress < 1;

  return (
    <PressableFeedback
      onPress={onPress}
      isDisabled={!onPress || inProgress}
      animation={false}
      style={{ width, height }}>
      <PressableFeedback.Scale>
        <View
          style={[
            styles.card,
            { width, height },
            selected && styles.cardSelected,
          ]}>
          {imageSource ? (
            <Image
              source={imageSource}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
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
            <View
              style={[StyleSheet.absoluteFillObject, { backgroundColor: '#1a1a1a' }]}
            />
          )}

          {inProgress && (
            <View style={styles.progressOverlay}>
              <Text size={14} bold style={{ color: '#fff' }}>
                {Math.round((activeDownloadProgress ?? 0) * 100)}%
              </Text>
            </View>
          )}

          {showPlayBadge && !inProgress && (
            <View style={styles.playBadge}>
              <Icon name="mdi:play" size={16} color="#fff" />
            </View>
          )}

          {!downloaded && entry && !inProgress && (
            <View style={styles.downloadBadge}>
              <Icon name="mdi:cloud-download-outline" size={12} color="#fff" />
            </View>
          )}
        </View>
      </PressableFeedback.Scale>
    </PressableFeedback>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: '#3B82F6',
  },
  progressOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
