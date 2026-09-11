import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { DemoHomeFeed } from '../components/DemoHomeFeed';
import { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { ScreenContainer } from '@/features/contacts/components/ScreenContainer';
import {
  HomeFeed,
  FEED_FILTER_FOR_YOU,
  FEED_FILTER_FOLLOWING_POPULAR,
  FEED_FILTER_FOLLOWING_RECENT,
} from '@/features/feed/components/HomeFeed';
import { SearchOverlay } from '@/shared/ui/composed/search/SearchOverlay';
import { ComposeFab } from '@/features/composer/ui/ComposeFab';
import { E2EHerouiMenuProbe } from '@/shared/lib/popup/E2EActionMenuProbe';
import { FeedTabButton } from '@/features/feed/components/FeedTabButton';
import { Log, feedLog, useLifecycleLogger } from '@/shared/lib/logger';
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
  activeTab: FeedTabId;
  followingMode: FollowingMode;
  onSelectForYou: () => void;
  onSelectFollowingMode: (mode: FollowingMode) => void;
};

function FeedFilters({
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
          icon: 'iconamoon:heart-fill',
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
          {FEED_TABS.map((tab) => (
            <FeedTabButton
              key={tab.id}
              label={tab.label}
              active={activeTab === tab.id}
              showChevron={tab.opensMenu}
              onPress={() => handleTabPress(tab.id)}
            />
          ))}
        </View>
      </View>
    </Log>
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
});

export function FeedScreen() {
  useLifecycleLogger('FeedScreen', feedLog);
  const mockMode = useSettingsStore((state) => state.mockMode);

  const [activeTab, setActiveTab] = useState<FeedTabId>(FEED_TAB_FOR_YOU);
  const [followingMode, setFollowingMode] = useState<FollowingMode>('Popular');
  const [surface, separator] = useThemeColor(['surface', 'separator-secondary'] as const);

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
          activeTab={activeTab}
          followingMode={followingMode}
          onSelectForYou={handleSelectForYou}
          onSelectFollowingMode={handleSelectFollowingMode}
        />
      </View>

      <ScreenContainer>
        {mockMode ? <DemoHomeFeed /> : <HomeFeed activeFilter={activeFilter} />}
      </ScreenContainer>
      <ComposeFab />
      <SearchOverlay recentContext="feed" />
      {/* The Following tab opens a heroui actionMenuPopup (Popular/Recent),
          whose rows are AX-invisible under FullWindowOverlay — mirror its open
          state so e2e can wait before a coordinate tap (same as WalletScreen). */}
      <E2EHerouiMenuProbe />
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
});
