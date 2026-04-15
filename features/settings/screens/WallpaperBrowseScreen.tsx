import React, { useEffect, useMemo, useCallback } from 'react';
import { ScrollView, StyleSheet, FlatList } from 'react-native';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Text } from '@/shared/ui/primitives/Text';
import Image from '@/shared/ui/primitives/Image';
import { router } from 'expo-router';
import { PressableFeedback } from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import type { WallpaperCatalogEntry } from '@/shared/stores/global/wallpaperStore';
import { THEMES } from '@/shared/providers/ThemeProvider';
import { refreshCatalog } from '@/shared/lib/wallpaperSync';
import Container from '@/shared/ui/composed/Container';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { Screen, log, useLifecycleLogger } from '@/shared/lib/logger';

const CARD_WIDTH = 140;
const CARD_IMAGE_HEIGHT = 186;
const PALETTE_SHADES = ['950', '900', '800', '700', '600', '500', '400', '300', '200', '100', '50', '0'] as const;

const BASE_THEMES = [
  { name: 'dark', displayName: 'Dark' },
  { name: 'navy', displayName: 'Navy' },
  { name: 'sunset', displayName: 'Sunset' },
  { name: 'beige', displayName: 'Beige' },
  { name: 'crimson-night', displayName: 'Crimson Night' },
  { name: 'twilight-amber', displayName: 'Twilight Amber' },
  { name: 'velvet-emerald', displayName: 'Velvet Emerald' },
];

// ---------------------------------------------------------------------------
// Palette row — accepts either a theme name (looks up THEMES) or raw palette
// ---------------------------------------------------------------------------

const PaletteRow = React.memo(({
  themeName,
  palette,
}: {
  themeName?: string;
  palette?: Record<string, string>;
}) => {
  const colors = palette
    || (themeName ? THEMES[themeName as keyof typeof THEMES] as Record<string, string> | undefined : undefined);
  if (!colors) return null;

  return (
    <View style={styles.paletteSection}>
      <View style={styles.paletteRow}>
        {PALETTE_SHADES.map((shade) => (
          <View
            key={shade}
            style={[styles.paletteDot, { backgroundColor: colors[shade] || '#333' }]}
          />
        ))}
      </View>
    </View>
  );
});

PaletteRow.displayName = 'PaletteRow';

// ---------------------------------------------------------------------------
// Theme card
// ---------------------------------------------------------------------------

const ThemeCard = React.memo(({
  themeName,
  displayName,
  isActive,
  onPress,
  imageSource,
  palette,
  downloadProgress,
  showDownloadIcon,
}: {
  themeName: string;
  displayName: string;
  isActive: boolean;
  onPress: () => void;
  imageSource?: any;
  palette?: Record<string, string>;
  downloadProgress?: number;
  showDownloadIcon?: boolean;
}) => {
  const themeColors = palette
    || (THEMES[themeName as keyof typeof THEMES] as Record<string, string> | undefined);

  const isInProgress = downloadProgress !== undefined && downloadProgress < 1;
  const isCompleted = downloadProgress !== undefined && downloadProgress >= 1;

  return (
    <PressableFeedback
      onPress={onPress}
      disabled={isInProgress}
      animation={false}
      style={{ width: CARD_WIDTH, marginRight: 12 }}>
      <PressableFeedback.Scale>
        <View style={styles.cardImage}>
          {imageSource ? (
            <Image source={imageSource} style={StyleSheet.absoluteFillObject} contentFit="cover" />
          ) : themeColors ? (
            <LinearGradient
              colors={[
                themeColors['800'] || '#1a1a1a',
                themeColors['900'] || '#0d0d0d',
                themeColors['950'] || '#000000',
              ]}
              style={StyleSheet.absoluteFillObject}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#1a1a1a' }]} />
          )}

          {isInProgress && (
            <View style={styles.progressOverlay}>
              <Text size={14} bold style={{ color: '#fff' }}>
                {Math.round(downloadProgress * 100)}%
              </Text>
            </View>
          )}
          {isCompleted && (
            <View style={styles.progressOverlay}>
              <Icon name="mdi:check-circle" size={28} color="#fff" />
            </View>
          )}
          {isActive && !isInProgress && !isCompleted && (
            <View style={styles.activeBadge}>
              <Icon name="mdi:check-circle" size={14} color="#fff" />
            </View>
          )}
          {showDownloadIcon && !isActive && !isInProgress && !isCompleted && (
            <View style={styles.downloadBadge}>
              <Icon name="mdi:cloud-download-outline" size={12} color="#fff" />
            </View>
          )}
        </View>

        <PaletteRow themeName={themeName} palette={palette} />

        <Text size={12} numberOfLines={1} style={styles.cardName}>
          {displayName}
        </Text>
      </PressableFeedback.Scale>
    </PressableFeedback>
  );
});

ThemeCard.displayName = 'ThemeCard';

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

const ThemeSection = ({
  title,
  profile,
  children,
}: {
  title: string;
  profile?: { pubkey: string; displayName: string; picture: string; followers?: number } | null;
  children: React.ReactNode;
}) => {
  const foreground = useThemeColor('foreground');

  const openProfile = useCallback(() => {
    if (profile?.pubkey) {
      router.navigate({ pathname: '/(user-flow)/profile' as any, params: { pubkey: profile.pubkey } });
    }
  }, [profile?.pubkey]);

  return (
    <View style={styles.section}>
      <HStack style={styles.sectionHeader}>
        <HStack style={{ alignItems: 'center', gap: 8, flex: 1 }}>
          {profile?.picture ? (
            <PressableFeedback onPress={openProfile} animation={false}>
              <PressableFeedback.Scale>
                <Image source={{ uri: profile.picture }} style={styles.publisherAvatar} contentFit="cover" />
              </PressableFeedback.Scale>
            </PressableFeedback>
          ) : null}
          <VStack>
            <Text size={13} medium style={{ color: opacity(foreground, 0.5), letterSpacing: 1.5 }}>
              {title}
            </Text>
            {profile?.displayName ? (
              <PressableFeedback onPress={openProfile} animation={false}>
                <PressableFeedback.Scale>
                  <HStack style={{ alignItems: 'center', gap: 4, marginTop: 1 }}>
                    <Text size={11} bold style={{ color: '#3B82F6' }}>
                      {profile.displayName}
                    </Text>
                    {profile.followers ? (
                      <>
                        <Text size={9} style={{ color: opacity(foreground, 0.15) }}>
                          {'•'}
                        </Text>
                        <HStack style={{ alignItems: 'center', gap: 3 }}>
                          <Icon name="mdi:account-group" size={12} color="#3B82F6" />
                          <Text size={12} bold style={{ color: '#3B82F6' }}>
                            {profile.followers.toLocaleString()}
                          </Text>
                        </HStack>
                      </>
                    ) : null}
                  </HStack>
                </PressableFeedback.Scale>
              </PressableFeedback>
            ) : null}
          </VStack>
        </HStack>
      </HStack>
      {children}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function WallpaperBrowseScreen() {
  useLifecycleLogger('WallpaperBrowseScreen');

  const insets = useSafeAreaInsets();
  const catalog = useWallpaperStore((s) => s.catalog);
  const albums = useWallpaperStore((s) => s.albums);
  const downloaded = useWallpaperStore((s) => s.downloaded);
  const activeDownloads = useWallpaperStore((s) => s.activeDownloads);
  const downloadWallpaper = useWallpaperStore((s) => s.downloadWallpaper);
  const currentTheme = useSettingsStore((s) => s.getTheme());
  const setTheme = useSettingsStore((s) => s.setTheme);

  useEffect(() => {
    refreshCatalog();
  }, []);

  const handleApplyTheme = useCallback(
    (themeName: string) => {
      log.info('settings.theme.change', { from: currentTheme, to: themeName });
      setTheme(themeName);
      router.back();
    },
    [setTheme, currentTheme],
  );

  // Group catalog wallpapers by album
  const albumGroups = useMemo(() => {
    const groups = new Map<string, WallpaperCatalogEntry[]>();
    for (const w of catalog) {
      const existing = groups.get(w.albumSlug) || [];
      existing.push(w);
      groups.set(w.albumSlug, existing);
    }
    // Sort wallpapers within each group newest-first
    for (const [, entries] of groups) {
      entries.sort((a, b) => b.createdAt - a.createdAt);
    }
    // Sort albums by newest wallpaper in each group (newest album first)
    return [...groups.entries()].sort((a, b) => {
      const aNewest = a[1][0]?.createdAt ?? 0;
      const bNewest = b[1][0]?.createdAt ?? 0;
      return bNewest - aNewest;
    });
  }, [catalog, albums]);

  const getAlbum = (slug: string) => {
    return albums.find((a: any) => a.slug === slug);
  };

  return (
    <Container>
      <Screen name="WallpaperBrowseScreen">
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}
          showsVerticalScrollIndicator={false}>


          {/* Nostr wallpaper albums */}
          {albumGroups.map(([slug, wallpapers]) => {
            const album = getAlbum(slug);
            return (
            <ThemeSection
              key={slug}
              title={(album?.displayName || slug).toUpperCase()}
              profile={album?.author ?? null}>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={wallpapers}
                keyExtractor={(item) => item.eventId}
                renderItem={({ item: w }) => {
                  const isDownloaded = !!downloaded[w.themeName];
                  const progress = activeDownloads[w.themeName];
                  return (
                    <ThemeCard
                      themeName={w.themeName}
                      displayName={w.displayName}
                      isActive={currentTheme === w.themeName}
                      showDownloadIcon={!isDownloaded}
                      downloadProgress={progress}
                      palette={w.palette as Record<string, string>}
                      onPress={() => {
                        if (isDownloaded) {
                          handleApplyTheme(w.themeName);
                        } else {
                          downloadWallpaper(w);
                        }
                      }}
                      imageSource={
                        isDownloaded
                          ? { uri: downloaded[w.themeName].localUri }
                          : { uri: w.thumbUrl }
                      }
                    />
                  );
                }}
                contentContainerStyle={styles.listContent}
              />
            </ThemeSection>
          );})}

          {/* Solid color themes */}
          <ThemeSection title="COLOR THEMES">
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={BASE_THEMES}
              keyExtractor={(item) => item.name}
              renderItem={({ item }) => (
                <ThemeCard
                  themeName={item.name}
                  displayName={item.displayName}
                  isActive={currentTheme === item.name}
                  onPress={() => handleApplyTheme(item.name)}
                />
              )}
              contentContainerStyle={styles.listContent}
            />
          </ThemeSection>

        </ScrollView>
      </Screen>
    </Container>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingTop: 8,
  },
  publisherAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#333',
  },
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    paddingHorizontal: 20,
    marginBottom: 12,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: 20,
  },
  cardImage: {
    width: CARD_WIDTH,
    height: CARD_IMAGE_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  activeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
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
  progressOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  cardName: {
    color: '#fff',
    marginTop: 6,
  },
  paletteSection: {
    marginTop: 4,
  },
  paletteRow: {
    flexDirection: 'row',
    gap: 2,
  },
  paletteDot: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
});
