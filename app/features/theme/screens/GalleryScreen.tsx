/**
 * Gallery — albums grouped by (topic, author).
 *
 * Tapping an album applies it to the draft (wipe + re-randomise) and
 * returns to Theme Preview in pending state. Refreshes the catalog on
 * mount so newly-published albums show up without a restart — mirrors
 * the subscription pattern of WallpaperBrowseScreen.
 */

import { useCallback, useEffect } from 'react';
// Tolerated seam exception: short horizontal album shelves nested inside the
// page ScrollView — FlashList can't virtualize inside an unbounded parent.
// ast-grep-ignore: flatlist-outside-list-seam-tsx
import { FlatList, ScrollView, useWindowDimensions } from 'react-native';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { PressableFeedback } from 'heroui-native';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { Image } from '@/shared/ui/primitives/Image';
import Icon from 'assets/icons';
import { Screen } from '@/shared/ui/composed/Screen';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useLifecycleLogger, log } from '@/shared/lib/logger';
import { refreshCatalog } from '@/shared/lib/wallpaperSync';
import { STAT_COLOR_SOCIAL, STAT_ICONS } from '@/shared/ui/composed/RowStatsAccent';
import { withAlpha } from '@/shared/lib/color';
import { UnitPreviewCard } from '@/features/theme/components/UnitPreviewCard';
import { useThemeDraft } from '@/features/theme/lib/themeDraft';
import {
  useAlbumList,
  NEW_BADGE_WINDOW_MS,
  type AlbumListEntry,
  type AlbumAuthor,
} from '@/features/theme/lib/useAlbumList';

const PREVIEW_UNIT_IDS = ['sat', 'usd', 'eur', 'gbp'];
const CARD_RATIO = 2.05;
const CARD_SPACING = 16;
const SECTION_PADDING = 20;

export function GalleryScreen() {
  useLifecycleLogger('GalleryScreen');

  const { width: screenWidth } = useWindowDimensions();
  const foreground = useThemeColor('foreground');
  const headerHeight = useHeaderHeight();

  const activeAlbumSlug = useThemeDraft((s) => s.activeAlbumSlug);
  const setAlbum = useThemeDraft((s) => s.setAlbum);

  const { byTopic } = useAlbumList();

  // Refresh catalog on mount — same pattern as WallpaperBrowseScreen.
  // The wallpaperStore subscription wired into useAlbumList updates the
  // grouped sections automatically when new albums arrive.
  useEffect(() => {
    const controller = new AbortController();
    void refreshCatalog(controller.signal);
    return () => controller.abort();
  }, []);

  const cardWidth = Math.round(screenWidth * 0.44);
  const cardHeight = cardWidth * CARD_RATIO;

  const handlePickAlbum = useCallback(
    (slug: string) => {
      log.info('theme.gallery.pick_album', { slug });
      setAlbum(slug, PREVIEW_UNIT_IDS);
      router.back();
    },
    [setAlbum]
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Gallery' }} />
      <Screen name="GalleryScreen" scroll="custom">
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, paddingTop: headerHeight + 8 }}
          showsVerticalScrollIndicator={false}
          // Android: gallery opens as a form-sheet; opt into nested scrolling so
          // dragging the page down scrolls instead of dismissing. No-op on iOS.
          nestedScrollEnabled>
          {byTopic.length === 0 ? (
            <Text size={13} className="mt-12 text-center opacity-50" style={{ color: foreground }}>
              Loading albums…
            </Text>
          ) : null}
          {byTopic.map((group) => (
            <View key={group.key} className="mt-5">
              <SectionHeader topic={group.topic} author={group.author} />
              <FlatList
                horizontal
                data={group.albums}
                keyExtractor={(a) => a.slug}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: SECTION_PADDING }}
                renderItem={({ item }) => (
                  <AlbumCard
                    album={item}
                    isActive={activeAlbumSlug === item.slug}
                    cardWidth={cardWidth}
                    cardHeight={cardHeight}
                    onPress={() => handlePickAlbum(item.slug)}
                  />
                )}
              />
            </View>
          ))}
        </ScrollView>
      </Screen>
    </>
  );
}

function SectionHeader({ topic, author }: { topic: string; author: AlbumAuthor | null }) {
  const foreground = useThemeColor('foreground');
  const openProfile = () => {
    if (author?.pubkey) {
      router.navigate({
        pathname: '/(user-flow)/profile',
        params: { pubkey: author.pubkey },
      });
    }
  };

  return (
    <HStack
      className="mb-3 items-center justify-between"
      style={{ paddingHorizontal: SECTION_PADDING }}>
      <HStack style={{ alignItems: 'center', gap: 10, flex: 1 }}>
        {author?.picture ? (
          <PressableFeedback onPress={openProfile} animation={false}>
            <PressableFeedback.Scale>
              <Image
                source={{ uri: author.picture }}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#333' }}
                contentFit="cover"
              />
            </PressableFeedback.Scale>
          </PressableFeedback>
        ) : null}
        <VStack style={{ flex: 1 }}>
          <Text size={13} medium style={{ color: withAlpha(foreground, 0.5), letterSpacing: 1.5 }}>
            {topic.toUpperCase()}
          </Text>
          {author?.displayName ? (
            <PressableFeedback onPress={openProfile} animation={false}>
              <PressableFeedback.Scale>
                <HStack style={{ alignItems: 'center', gap: 4, marginTop: 1 }}>
                  <Text size={11} bold style={{ color: STAT_COLOR_SOCIAL }}>
                    {author.displayName}
                  </Text>
                  {author.followers ? (
                    <>
                      <Text size={9} style={{ color: withAlpha(foreground, 0.15) }}>
                        {'•'}
                      </Text>
                      <HStack style={{ alignItems: 'center', gap: 3 }}>
                        <Icon name={STAT_ICONS.followers} size={12} color={STAT_COLOR_SOCIAL} />
                        <Text size={12} bold style={{ color: STAT_COLOR_SOCIAL }}>
                          {author.followers.toLocaleString()}
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
  );
}

function AlbumCard({
  album,
  isActive,
  cardWidth,
  cardHeight,
  onPress,
}: {
  album: AlbumListEntry;
  isActive: boolean;
  cardWidth: number;
  cardHeight: number;
  onPress: () => void;
}) {
  const foreground = useThemeColor('foreground');
  const isNew = album.newestAt > 0 && Date.now() - album.newestAt < NEW_BADGE_WINDOW_MS;
  return (
    <VStack gap={6} style={{ marginRight: CARD_SPACING }} align="center">
      <UnitPreviewCard
        themeName={album.coverThemeName || 'dark'}
        width={cardWidth}
        height={cardHeight}
        onPress={onPress}
        selected={isActive}
        badge={isNew ? 'New' : undefined}
        testID={`album-card-${album.slug}`}
      />
      <Text size={13} medium style={{ color: foreground }}>
        {album.displayName}
      </Text>
    </VStack>
  );
}
