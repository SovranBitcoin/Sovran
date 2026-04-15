import React, { useState, useCallback } from 'react';
import { StyleSheet, Alert } from 'react-native';
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
import Container from '@/shared/ui/composed/Container';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { Screen, useLifecycleLogger, log } from '@/shared/lib/logger';

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WallpaperPreviewScreen() {
  useLifecycleLogger('WallpaperPreviewScreen');

  const { themeName } = useLocalSearchParams<{ themeName: string }>();
  const foreground = useThemeColor('foreground');
  const insets = useSafeAreaInsets();

  const catalog = useWallpaperStore((s) => s.catalog);
  const downloaded = useWallpaperStore((s) => s.downloaded);
  const activeDownloads = useWallpaperStore((s) => s.activeDownloads);
  const downloadWallpaper = useWallpaperStore((s) => s.downloadWallpaper);
  const removeDownloaded = useWallpaperStore((s) => s.removeDownloaded);
  const currentTheme = useSettingsStore((s) => s.getTheme());
  const setTheme = useSettingsStore((s) => s.setTheme);

  const [downloading, setDownloading] = useState(false);

  const wallpaper = catalog.find((w) => w.themeName === themeName);
  const isDownloaded = !!downloaded[themeName ?? ''];
  const isActive = currentTheme === themeName;
  const downloadProgress = activeDownloads[themeName ?? ''];

  if (!wallpaper) {
    return (
      <Container>
        <Screen name="WallpaperPreviewScreen">
          <VStack spacing={8} style={styles.centered}>
            <Text size={16} style={{ color: opacity(foreground, 0.5) }}>
              Wallpaper not found
            </Text>
          </VStack>
        </Screen>
      </Container>
    );
  }

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const success = await downloadWallpaper(wallpaper);
      if (!success) {
        Alert.alert('Download Failed', `Could not download "${wallpaper.displayName}". Check your connection and try again.`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Download Failed', message);
    } finally {
      setDownloading(false);
    }
  }, [wallpaper, downloadWallpaper]);

  const handleApply = useCallback(() => {
    if (themeName) {
      log.info('wallpaper.apply', { themeName });
      setTheme(themeName);
      router.back();
    }
  }, [themeName, setTheme]);

  const handleDelete = useCallback(async () => {
    if (!themeName) return;
    Alert.alert(
      'Delete Wallpaper',
      `Remove "${wallpaper.displayName}" from your device?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await removeDownloaded(themeName);
          },
        },
      ],
    );
  }, [themeName, wallpaper?.displayName, removeDownloaded]);

  return (
    <Container>
      <Screen name="WallpaperPreviewScreen">
        <View style={styles.container}>
          {/* Preview image */}
          <View style={styles.previewContainer}>
            <Image
              source={{ uri: wallpaper.thumbUrl }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
            />
            {/* Gradient overlay at bottom */}
            <View style={styles.gradientOverlay} />
          </View>

          {/* Info panel */}
          <View style={[styles.infoPanel, { paddingBottom: insets.bottom + 16 }]}>
            {/* Title & metadata */}
            <VStack spacing={4}>
              <Text size={20} bold style={{ color: '#fff' }}>
                {wallpaper.displayName}
              </Text>
              <HStack spacing={12}>
                <Text size={12} style={styles.metaText}>
                  {formatFileSize(wallpaper.fileSize)}
                </Text>
                <Text size={12} style={styles.metaText}>
                  {wallpaper.dimensions}
                </Text>
                <Text size={12} style={styles.metaText}>
                  {wallpaper.albumSlug}
                </Text>
              </HStack>
            </VStack>

            <Spacer size={12} />

            {/* Color palette */}
            {wallpaper.dominantColors.length > 0 && (
              <HStack spacing={8}>
                {wallpaper.dominantColors.map((c, i) => (
                  <View
                    key={i}
                    style={[styles.colorDot, { backgroundColor: c.hex }]}
                  />
                ))}
                {wallpaper.gradientColors.length > 0 && (
                  <>
                    <View style={styles.colorSeparator} />
                    {wallpaper.gradientColors.map((c, i) => (
                      <View
                        key={`g-${i}`}
                        style={[styles.colorDot, { backgroundColor: c.hex }]}
                      />
                    ))}
                  </>
                )}
              </HStack>
            )}

            <Spacer size={16} />

            {/* Action buttons */}
            <HStack spacing={12}>
              {!isDownloaded ? (
                <PressableFeedback
                  onPress={handleDownload}
                  disabled={downloading}
                  animation={false}
                  style={styles.primaryButton}>
                  <PressableFeedback.Scale style={styles.buttonInner}>
                    {downloading || downloadProgress !== undefined ? (
                      <>
                        <View style={styles.miniSpinner} />
                        <Text size={14} bold style={{ color: '#fff' }}>
                          {downloadProgress !== undefined
                            ? `${Math.round(downloadProgress * 100)}%`
                            : 'Downloading...'}
                        </Text>
                      </>
                    ) : (
                      <>
                        <Icon name="mdi:download" size={18} color="#fff" />
                        <Text size={14} bold style={{ color: '#fff' }}>
                          Download
                        </Text>
                      </>
                    )}
                  </PressableFeedback.Scale>
                </PressableFeedback>
              ) : (
                <>
                  <PressableFeedback
                    onPress={handleApply}
                    disabled={isActive}
                    animation={false}
                    style={[styles.primaryButton, isActive && styles.disabledButton]}>
                    <PressableFeedback.Scale style={styles.buttonInner}>
                      <Icon
                        name={isActive ? 'mdi:check-circle' : 'mdi:brush'}
                        size={18}
                        color="#fff"
                      />
                      <Text size={14} bold style={{ color: '#fff' }}>
                        {isActive ? 'Active' : 'Apply'}
                      </Text>
                    </PressableFeedback.Scale>
                  </PressableFeedback>

                  <PressableFeedback
                    onPress={handleDelete}
                    animation={false}
                    style={styles.deleteButton}>
                    <PressableFeedback.Scale style={styles.buttonInner}>
                      <Icon name="mdi:delete-outline" size={18} color="#ef4444" />
                    </PressableFeedback.Scale>
                  </PressableFeedback>
                </>
              )}
            </HStack>
          </View>
        </View>
      </Screen>
    </Container>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  gradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 200,
    backgroundColor: 'transparent',
    // Use a solid dark overlay since LinearGradient not imported here for simplicity
    opacity: 0.4,
  },
  infoPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  metaText: {
    color: 'rgba(255,255,255,0.5)',
  },
  colorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  colorSeparator: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#3b82f6',
    borderRadius: 12,
  },
  disabledButton: {
    backgroundColor: 'rgba(59, 130, 246, 0.4)',
  },
  deleteButton: {
    width: 48,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  miniSpinner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    borderTopColor: '#fff',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
