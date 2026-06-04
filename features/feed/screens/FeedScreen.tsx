import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSearchContext } from '@/shared/ui/composed/SearchLayout';
import { ScreenContainer } from '@/features/contacts/components/ScreenContainer';
import {
  HomeFeed,
  FEED_FILTER_FOR_YOU,
  FEED_FILTER_FOLLOWING_POPULAR,
  FEED_FILTER_FOLLOWING_RECENT,
} from '@/features/feed/components/HomeFeed';
import { RecentPeopleSearchStrip } from '@/features/feed/components/RecentPeopleSearchStrip';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import Icon from '@/assets/icons';
import { Log, feedLog, useLifecycleLogger } from '@/shared/lib/logger';
import { SearchResultsList } from '@/shared/ui/composed/SearchResultsList';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import opacity from 'hex-color-opacity';
import { actionMenuPopup } from '@/shared/lib/popup';

const SEARCH_FILTERS_HEIGHT = 56;
const FEED_TAB_FOR_YOU = 'for-you';
const FEED_TAB_FOLLOWING = 'following';

type FeedTabId = typeof FEED_TAB_FOR_YOU | typeof FEED_TAB_FOLLOWING;
type FollowingMode = 'Popular' | 'Recent';

const FEED_TABS: { id: FeedTabId; label: string; opensMenu?: boolean }[] = [
  { id: FEED_TAB_FOR_YOU, label: 'For You' },
  { id: FEED_TAB_FOLLOWING, label: 'Following', opensMenu: true },
];

type FeedFiltersProps = {
  isSearching: boolean;
  activeTab: FeedTabId;
  followingMode: FollowingMode;
  onSelectForYou: () => void;
  onSelectFollowingMode: (mode: FollowingMode) => void;
};

function FeedFilters({
  isSearching,
  activeTab,
  followingMode,
  onSelectForYou,
  onSelectFollowingMode,
}: FeedFiltersProps) {
  const openFollowingMenu = useCallback(() => {
    actionMenuPopup({
      title: 'Following',
      buttons: [
        {
          text: 'Popular',
          description: 'Top followed posts and replies by recent like activity.',
          icon: 'mdi:trending-up',
          variant: followingMode === 'Popular' ? 'primary' : undefined,
          testID: 'feed-following-popular',
          onPress: (close) => {
            close();
            onSelectFollowingMode('Popular');
          },
        },
        {
          text: 'Recent',
          description: 'Latest posts and replies from people you follow.',
          icon: 'mdi:clock-outline',
          variant: followingMode === 'Recent' ? 'primary' : undefined,
          testID: 'feed-following-recent',
          onPress: (close) => {
            close();
            onSelectFollowingMode('Recent');
          },
        },
      ],
    });
  }, [followingMode, onSelectFollowingMode]);

  const handleTabPress = useCallback(
    (tab: FeedTabId) => {
      if (tab === FEED_TAB_FOR_YOU) {
        onSelectForYou();
        return;
      }
      openFollowingMenu();
    },
    [onSelectForYou, openFollowingMenu]
  );

  return (
    <Log name="FeedFilters">
      <View style={filtersInnerStyles.container}>
        <View style={filtersInnerStyles.content}>
          {isSearching ? (
            <FeedTabButton label="People" active={true} />
          ) : (
            FEED_TABS.map((tab) => (
              <FeedTabButton
                key={tab.id}
                label={tab.label}
                active={activeTab === tab.id}
                showChevron={tab.opensMenu}
                onPress={() => handleTabPress(tab.id)}
              />
            ))
          )}
        </View>
      </View>
    </Log>
  );
}

function FeedTabButton({
  label,
  active,
  showChevron = false,
  onPress,
}: {
  label: string;
  active: boolean;
  showChevron?: boolean;
  onPress?: () => void;
}) {
  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);
  const activeBg = useMemo(() => opacity(surfaceTertiary, 0.5), [surfaceTertiary]);
  const pressedBg = useMemo(() => opacity(surfaceTertiary, 0.65), [surfaceTertiary]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      haptics={!!onPress}
      activeOpacity={1}
      style={({ pressed }) => [
        filtersInnerStyles.tabButton,
        { backgroundColor: pressed ? pressedBg : active ? activeBg : 'transparent' },
      ]}>
      <View style={filtersInnerStyles.tabInner}>
        <Text style={[filtersInnerStyles.tabLabel, { color: foreground }]}>{label}</Text>
        {showChevron ? <Icon name="mdi:chevron-down" size={16} color={foreground} /> : null}
      </View>
    </Pressable>
  );
}

const filtersInnerStyles = StyleSheet.create({
  container: {
    height: SEARCH_FILTERS_HEIGHT,
    marginHorizontal: -20,
  },
  content: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 20,
    alignItems: 'center',
    height: SEARCH_FILTERS_HEIGHT,
  },
  tabButton: {
    borderRadius: 999,
  },
  tabInner: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tabLabel: {
    fontSize: 17,
  },
});

export function FeedScreen() {
  useLifecycleLogger('FeedScreen', feedLog);

  const { isSearching, searchQuery } = useSearchContext();
  const [activeTab, setActiveTab] = useState<FeedTabId>(FEED_TAB_FOR_YOU);
  const [followingMode, setFollowingMode] = useState<FollowingMode>('Popular');
  const [foreground, surface, separator, muted] = useThemeColor([
    'foreground',
    'surface',
    'separator-secondary',
    'muted',
  ] as const);

  const activeFilter = useMemo(() => {
    if (activeTab === FEED_TAB_FOR_YOU) return FEED_FILTER_FOR_YOU;
    return followingMode === 'Popular'
      ? FEED_FILTER_FOLLOWING_POPULAR
      : FEED_FILTER_FOLLOWING_RECENT;
  }, [activeTab, followingMode]);

  const handleSelectForYou = useCallback(() => {
    feedLog.info('feed.filter.change', { filter: FEED_FILTER_FOR_YOU });
    setActiveTab(FEED_TAB_FOR_YOU);
  }, []);

  const handleSelectFollowingMode = useCallback((mode: FollowingMode) => {
    const filter =
      mode === 'Popular' ? FEED_FILTER_FOLLOWING_POPULAR : FEED_FILTER_FOLLOWING_RECENT;
    feedLog.info('feed.filter.change', { filter, mode });
    setFollowingMode(mode);
    setActiveTab(FEED_TAB_FOLLOWING);
  }, []);

  const hasSearchQuery = searchQuery.trim().length > 0;
  const showSearchResults = isSearching && hasSearchQuery;
  const showSearchPrompt = isSearching && !hasSearchQuery;

  return (
    <Log name="FeedScreen" style={[styles.root, { backgroundColor: surface }]}>
      <View
        style={[
          styles.filtersRow,
          {
            backgroundColor: surface,
            paddingHorizontal: 20,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: separator,
          },
        ]}>
        <FeedFilters
          isSearching={isSearching}
          activeTab={activeTab}
          followingMode={followingMode}
          onSelectForYou={handleSelectForYou}
          onSelectFollowingMode={handleSelectFollowingMode}
        />
      </View>

      <ScreenContainer>
        {showSearchResults ? (
          <SearchResultsList searchQuery={searchQuery} />
        ) : showSearchPrompt ? (
          <View style={styles.searchPromptRoot}>
            <RecentPeopleSearchStrip />
            <VStack spacing={24} align="center" className="mt-3 px-4" style={styles.flex1}>
              <VStack
                justify="center"
                align="center"
                className="bg-surface-secondary h-20 w-20 rounded-full">
                <Icon name="mingcute:search-3-line" size={40} color={muted} />
              </VStack>
              <VStack spacing={12}>
                <Text className="text-center" color={foreground} bold size={20}>
                  Search for someone by name
                </Text>
                <Text className="text-center" color={muted} size={16}>
                  Enter a name, NIP-05, or npub to find people
                </Text>
              </VStack>
            </VStack>
          </View>
        ) : (
          <HomeFeed activeFilter={activeFilter} />
        )}
      </ScreenContainer>
    </Log>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  filtersRow: {
    height: SEARCH_FILTERS_HEIGHT,
  },
  flex1: {
    flex: 1,
  },
  searchPromptRoot: {
    flex: 1,
    paddingHorizontal: 16,
  },
});
