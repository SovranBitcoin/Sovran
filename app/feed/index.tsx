import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { useSelector } from 'react-redux';
import { greys, Theme } from 'helper/colors';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
// todo migrate to legendlist
import { FlashList } from '@shopify/flash-list';
import PagerView from 'react-native-pager-view';
import { Post } from 'components/blocks/feed';
import { View } from 'components/ui/View';
import { Tabs } from 'components/ui/Tabs';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedRoute } from 'helper/navigation';
import { EventKind } from 'helper/constants';

const Feed = ({ theme, filters }: { theme: any; filters: any }) => {
  const { events } = useSubscribe({ filters });

  const sortedEvents = useMemo(
    () => (events ? [...events].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)) : []),
    [events]
  );
  return (
    <FlashList
      data={sortedEvents}
      renderItem={({ item }) => <Post {...({ post: item } as any)} key={item.id} />}
      keyExtractor={(event) => event?.id || ''}
      extraData={theme}
      onEndReached={() => {}}
      onEndReachedThreshold={0.5}
    />
  );
};

const TabTwoScreen = () => {
  const { pubkey } = useTypedRoute<'feed'>();
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const pagerRef = useRef(null);
  const [selectedTab, setSelectedTab] = useState('Feed');
  const tabs = useMemo(() => ['Feed'], []);

  const filters = useMemo(
    () => ({
      Feed: [
        {
          kinds: [EventKind.TextNote, EventKind.Repost, 30023],
          authors: [pubkey],
        },
      ],
    }),
    [pubkey]
  );

  const onPageSelected = useCallback(
    (event: any) => {
      const pageIndex = event.nativeEvent.position;
      setSelectedTab(tabs[pageIndex]);
    },
    [tabs]
  );

  const handleTabPress = useCallback((tab: string, index: number) => {
    setSelectedTab(tab);
    (pagerRef.current as any)?.setPage(index);
  }, []);

  useEffect(() => {
    setSelectedTab('Notifications');
  }, []);

  return (
    <View style={styles.container}>
      <View>
        <Tabs tabs={tabs} selectedTab={selectedTab} handleTabPress={handleTabPress} />
      </View>
      <PagerView
        ref={pagerRef}
        onPageSelected={onPageSelected}
        style={styles.pagerView}
        initialPage={0}>
        {tabs.map((tab, index) => (
          <View key={index.toString()} style={styles.pageContainer}>
            <Feed theme={theme} filters={filters[tab as keyof typeof filters]} />
          </View>
        ))}
      </PagerView>
    </View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      backgroundColor: greys(theme)[950],
      flex: 1,
      padding: 16,
    },
    pagerView: {
      height: Dimensions.get('window').height,
      marginLeft: -16,
      marginRight: -16,
      marginTop: 8,
    },
    pageContainer: {
      flex: 1,
      backgroundColor: greys(theme)[950],
      height: '100%',
      overflow: 'hidden',
    },
  });

export default withSheetProvider(TabTwoScreen);
