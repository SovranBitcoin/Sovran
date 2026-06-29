/**
 * Background — per-unit wallpaper picker, pushed from Theme Preview.
 *
 * Album pills at the top (Add-Mints-style) drive a PagerView underneath
 * where each page is that album's wallpaper grid. Swiping pages updates
 * the selected pill; tapping a pill animates to that page.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, useWindowDimensions } from 'react-native';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PagerView from 'react-native-pager-view';
import { z } from 'zod';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { Screen } from '@/shared/ui/composed/Screen';
import { useLifecycleLogger, log } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import { useThemeDraft } from '@/features/theme/lib/themeDraft';
import { useAlbumList } from '@/features/theme/lib/useAlbumList';
import { WallpaperThumbnail } from '@/features/theme/components/WallpaperThumbnail';
import { AlbumPillTabs } from '@/features/theme/components/AlbumPillTabs';
import { BUILTIN_COLORS_ALBUM_SLUG } from '@/shared/lib/theme/builtinAlbums';

const GRID_COLUMNS = 3;
const GRID_GAP = 10;
const GRID_HORIZONTAL_PADDING = 20;
const TABS_AREA_HEIGHT = 56;

const ParamsSchema = z.object({
  unitId: z.string().max(16).optional(),
});

export function BackgroundScreen() {
  useLifecycleLogger('BackgroundScreen');

  const params = useRouteParams(ParamsSchema, { where: 'theme-flow.background' });
  const unitId = params?.unitId ?? 'sat';

  const { width: screenWidth, height: windowHeight } = useWindowDimensions();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const catalog = useWallpaperStore((s) => s.catalog);
  const draftUnitTheme = useThemeDraft((s) => s.unitWallpapers[unitId]);
  const setUnitWallpaper = useThemeDraft((s) => s.setUnitWallpaper);

  const { albums, getAlbumWallpaperNames } = useAlbumList();

  const pagerRef = useRef<PagerView>(null);

  const currentUnitAlbumSlug = useMemo(() => {
    if (!draftUnitTheme) return BUILTIN_COLORS_ALBUM_SLUG;
    const match = catalog.find((w) => w.themeName === draftUnitTheme);
    return match?.albumSlug ?? BUILTIN_COLORS_ALBUM_SLUG;
  }, [catalog, draftUnitTheme]);

  const initialIndex = useMemo(() => {
    const idx = albums.findIndex((a) => a.slug === currentUnitAlbumSlug);
    return idx >= 0 ? idx : 0;
  }, [albums, currentUnitAlbumSlug]);

  const [activeIndex, setActiveIndex] = useState(initialIndex);

  // If the albums list changes shape (e.g. catalog refresh adds new album),
  // resnap to the unit's current album so the pager doesn't land on an
  // unrelated page.
  useEffect(() => {
    if (albums.length === 0) return;
    if (activeIndex >= albums.length) {
      setActiveIndex(0);
      pagerRef.current?.setPageWithoutAnimation(0);
    }
  }, [albums, activeIndex]);

  const tabLabels = useMemo(() => albums.map((a) => a.displayName), [albums]);
  const selectedTabLabel = tabLabels[activeIndex] ?? '';

  const handleTabSelect = useCallback(
    (label: string) => {
      const idx = tabLabels.indexOf(label);
      if (idx < 0) return;
      setActiveIndex(idx);
      pagerRef.current?.setPage(idx);
    },
    [tabLabels]
  );

  const onPageSelected = useCallback((event: { nativeEvent: { position: number } }) => {
    const idx = event.nativeEvent.position;
    setActiveIndex(idx);
  }, []);

  const cardWidth = Math.floor(
    (screenWidth - GRID_HORIZONTAL_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS
  );
  const cardHeight = Math.round(cardWidth * 1.55);

  const handlePickWallpaper = useCallback(
    (themeName: string) => {
      log.info('theme.background.pick', { themeName, unitId });
      setUnitWallpaper(unitId, themeName);
      router.back();
    },
    [setUnitWallpaper, unitId]
  );

  // Pager needs explicit height; carve out the space between tabs and the
  // bottom safe area so each page's grid can scroll vertically inside its
  // own bounds.
  const pagerHeight = windowHeight - headerHeight - TABS_AREA_HEIGHT - insets.bottom - 8;

  return (
    <>
      <Stack.Screen options={{ title: 'Background' }} />
      <Screen name="BackgroundScreen" scroll="custom">
        <View className="flex-1" style={{ paddingTop: headerHeight }}>
          <View className="justify-center" style={{ height: TABS_AREA_HEIGHT }}>
            <AlbumPillTabs
              tabs={tabLabels}
              selectedTab={selectedTabLabel}
              onSelect={handleTabSelect}
            />
          </View>

          {albums.length > 0 ? (
            <PagerView
              ref={pagerRef}
              style={{ height: pagerHeight }}
              initialPage={initialIndex}
              onPageSelected={onPageSelected}
              overdrag>
              {albums.map((album) => (
                <AlbumPage
                  key={album.slug}
                  slug={album.slug}
                  themeNames={getAlbumWallpaperNames(album.slug)}
                  catalog={catalog}
                  draftUnitTheme={draftUnitTheme}
                  cardWidth={cardWidth}
                  cardHeight={cardHeight}
                  onPick={handlePickWallpaper}
                />
              ))}
            </PagerView>
          ) : (
            <Text size={13} className="mt-8 text-center" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Loading albums…
            </Text>
          )}
        </View>
      </Screen>
    </>
  );
}

// ---------------------------------------------------------------------------
// Single page: FlatList grid of wallpapers for one album
// ---------------------------------------------------------------------------

const AlbumPage = React.memo(function AlbumPage({
  slug,
  themeNames,
  catalog,
  draftUnitTheme,
  cardWidth,
  cardHeight,
  onPick,
}: {
  slug: string;
  themeNames: string[];
  catalog: ReturnType<typeof useWallpaperStore.getState>['catalog'];
  draftUnitTheme: string | undefined;
  cardWidth: number;
  cardHeight: number;
  onPick: (themeName: string) => void;
}) {
  const renderWallpaper = useCallback(
    ({ item: themeName }: { item: string }) => {
      const entry = catalog.find((w) => w.themeName === themeName);
      const selected = draftUnitTheme === themeName;
      return (
        <View style={{ width: cardWidth, marginRight: GRID_GAP, marginBottom: GRID_GAP }}>
          <WallpaperThumbnail
            themeName={themeName}
            entry={entry}
            selected={selected}
            width={cardWidth}
            height={cardHeight}
            showPlayBadge={!!entry}
            onPress={() => onPick(themeName)}
          />
        </View>
      );
    },
    [catalog, draftUnitTheme, cardWidth, cardHeight, onPick]
  );

  return (
    <View key={slug} className="flex-1">
      <FlatList
        data={themeNames}
        keyExtractor={(n) => n}
        numColumns={GRID_COLUMNS}
        renderItem={renderWallpaper}
        // Android: this grid scrolls inside the theme form-sheet; opt into
        // nested scrolling so dragging it down scrolls instead of dismissing.
        nestedScrollEnabled
        contentContainerStyle={{
          paddingTop: 16,
          paddingHorizontal: GRID_HORIZONTAL_PADDING,
          paddingBottom: 48,
        }}
        ListEmptyComponent={
          <Text size={13} className="mt-8 text-center" style={{ color: 'rgba(255,255,255,0.4)' }}>
            No wallpapers in this album yet.
          </Text>
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
});
