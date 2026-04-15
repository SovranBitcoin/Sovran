import React, { useState, useMemo, useCallback } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, Alert } from 'react-native';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Text } from '@/shared/ui/primitives/Text';
import Image from '@/shared/ui/primitives/Image';
import { router, useLocalSearchParams } from 'expo-router';
import { PressableFeedback } from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import { syncAlbum, downloadAlbum, deleteAlbum } from '@/shared/lib/wallpaperSync';
import Container from '@/shared/ui/composed/Container';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { Screen, useLifecycleLogger, log } from '@/shared/lib/logger';

const CARD_GAP = 10;
const HORIZONTAL_PADDING = 16;

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WallpaperAlbumScreen() {
  useLifecycleLogger('WallpaperAlbumScreen');

  const { albumSlug } = useLocalSearchParams<{ albumSlug: string }>();
  const foreground = useThemeColor('foreground');
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const catalog = useWallpaperStore((s) => s.catalog);
  const albums = useWallpaperStore((s) => s.albums);
  const downloaded = useWallpaperStore((s) => s.downloaded);
  const activeDownloads = useWallpaperStore((s) => s.activeDownloads);
  const currentTheme = useSettingsStore((s) => s.getTheme());

  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ completed: number; total: number } | null>(null);

  const albumMeta = albums.find((a) => a.slug === albumSlug);
  const albumName = albumMeta?.displayName || albumSlug || 'Album';

  const albumWallpapers = useMemo(
    () => catalog.filter((w) => w.albumSlug === albumSlug).sort((a, b) => b.createdAt - a.createdAt),
    [catalog, albumSlug],
  );

  const downloadedCount = useMemo(
    () => albumWallpapers.filter((w) => !!downloaded[w.themeName]).length,
    [albumWallpapers, downloaded],
  );

  const cardWidth = (screenWidth - HORIZONTAL_PADDING * 2 - CARD_GAP * 2) / 3;
  const cardHeight = cardWidth * 1.77;

  const handleSync = useCallback(async () => {
    if (!albumSlug) return;
    setSyncing(true);
    setSyncProgress(null);
    try {
      await syncAlbum(albumSlug, (completed, total) => {
        setSyncProgress({ completed, total });
      });
    } catch (error: any) {
      Alert.alert('Sync Failed', error.message);
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }, [albumSlug]);

  const handleDownloadAll = useCallback(async () => {
    if (!albumSlug) return;
    setSyncing(true);
    try {
      await downloadAlbum(albumSlug, (completed, total) => {
        setSyncProgress({ completed, total });
      });
    } catch (error: any) {
      Alert.alert('Download Failed', error.message);
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }, [albumSlug]);

  const handleDeleteAll = useCallback(async () => {
    if (!albumSlug) return;
    Alert.alert(
      'Delete All',
      `Remove all downloaded wallpapers from "${albumName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setSyncing(true);
            try {
              await deleteAlbum(albumSlug);
            } finally {
              setSyncing(false);
            }
          },
        },
      ],
    );
  }, [albumSlug, albumName]);

  return (
    <Container>
      <Screen name="WallpaperAlbumScreen">
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}
          showsVerticalScrollIndicator={false}>
          {/* Album header */}
          <VStack spacing={4} style={styles.header}>
            <Text size={11} style={{ color: opacity(foreground, 0.4) }}>
              {albumWallpapers.length} wallpapers &middot; {downloadedCount} downloaded
            </Text>
            {albumMeta?.description && (
              <Text size={13} style={{ color: opacity(foreground, 0.5) }}>
                {albumMeta.description}
              </Text>
            )}
          </VStack>

          {/* Action buttons */}
          <HStack spacing={8} style={styles.actionRow}>
            <PressableFeedback
              onPress={handleSync}
              disabled={syncing}
              animation={false}
              style={styles.actionButton}>
              <PressableFeedback.Scale style={styles.actionButtonInner}>
                <Icon name="mdi:sync" size={16} color={foreground} />
                <Text size={12} style={{ color: foreground }}>Sync</Text>
              </PressableFeedback.Scale>
            </PressableFeedback>

            <PressableFeedback
              onPress={handleDownloadAll}
              disabled={syncing}
              animation={false}
              style={styles.actionButton}>
              <PressableFeedback.Scale style={styles.actionButtonInner}>
                <Icon name="mdi:download" size={16} color={foreground} />
                <Text size={12} style={{ color: foreground }}>Download All</Text>
              </PressableFeedback.Scale>
            </PressableFeedback>

            {downloadedCount > 0 && (
              <PressableFeedback
                onPress={handleDeleteAll}
                disabled={syncing}
                animation={false}
                style={styles.actionButton}>
                <PressableFeedback.Scale style={styles.actionButtonInner}>
                  <Icon name="mdi:delete-outline" size={16} color="#ef4444" />
                  <Text size={12} style={{ color: '#ef4444' }}>Delete All</Text>
                </PressableFeedback.Scale>
              </PressableFeedback>
            )}
          </HStack>

          {/* Progress */}
          {syncing && syncProgress && (
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${(syncProgress.completed / syncProgress.total) * 100}%` },
                  ]}
                />
              </View>
              <Text size={11} style={{ color: opacity(foreground, 0.5) }}>
                {syncProgress.completed} / {syncProgress.total}
              </Text>
            </View>
          )}

          <Spacer size={16} />

          {/* Wallpaper grid */}
          <View style={styles.grid}>
            {albumWallpapers.map((w) => {
              const isDownloaded = !!downloaded[w.themeName];
              const isActive = currentTheme === w.themeName;
              const downloadProgress = activeDownloads[w.themeName];

              return (
                <PressableFeedback
                  key={w.eventId}
                  onPress={() => {
                    router.push({
                      pathname: '/(settings-flow)/wallpaper-preview',
                      params: { themeName: w.themeName },
                    });
                  }}
                  animation={false}
                  style={{ width: cardWidth, marginBottom: CARD_GAP }}>
                  <PressableFeedback.Scale>
                    <View style={[styles.card, { width: cardWidth, height: cardHeight }]}>
                      <Image
                        source={{ uri: w.thumbUrl }}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                      />
                      {/* Status */}
                      {isActive && (
                        <View style={styles.activeBadge}>
                          <Icon name="mdi:check-circle" size={16} color="#fff" />
                        </View>
                      )}
                      {isDownloaded && !isActive && (
                        <View style={styles.downloadedBadge}>
                          <Icon name="mdi:check" size={12} color="#22c55e" />
                        </View>
                      )}
                      {downloadProgress !== undefined && downloadProgress < 1 && (
                        <View style={styles.progressOverlay}>
                          <Text size={14} bold style={{ color: '#fff' }}>
                            {Math.round(downloadProgress * 100)}%
                          </Text>
                        </View>
                      )}
                      {downloadProgress !== undefined && downloadProgress >= 1 && (
                        <View style={styles.progressOverlay}>
                          <Icon name="mdi:check-circle" size={28} color="#fff" />
                        </View>
                      )}
                    </View>
                    <Text size={11} numberOfLines={1} style={{ color: foreground, marginTop: 4 }}>
                      {w.displayName}
                    </Text>
                    <Text size={10} style={{ color: opacity(foreground, 0.4) }}>
                      {formatFileSize(w.fileSize)}
                    </Text>
                  </PressableFeedback.Scale>
                </PressableFeedback>
              );
            })}
          </View>
        </ScrollView>
      </Screen>
    </Container>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 8,
  },
  header: {
    marginBottom: 16,
  },
  actionRow: {
    marginBottom: 12,
  },
  actionButton: {
    flex: 1,
  },
  actionButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  progressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#3b82f6',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CARD_GAP,
  },
  card: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  activeBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadedBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
