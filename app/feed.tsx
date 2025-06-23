import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { Text } from 'components/common/Text';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { FlashList } from '@shopify/flash-list';
import PagerView from 'react-native-pager-view';
import { Post } from './ProfilePage/post';
import { EventKind } from './Profile';
import { useNostr } from 'helper/redux/nostr';
import { View } from 'components/common/View';
import { Tabs } from 'components/common/Tabs';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { memoizedGetTheme } from 'helper/redux/settings';

const Feed = ({ theme, filters }) => {
  const { events, isLoading } = useSubscribe({ filters });

  const sortedEvents = useMemo(
    () => (events ? [...events].sort((a, b) => b.created_at - a.created_at) : []),
    [events]
  );
  return isLoading ? (
    <Text style={styles.loadingText}>Loading...</Text>
  ) : (
    <FlashList
      data={sortedEvents}
      renderItem={({ item }) => <Post post={item} key={item.id} />}
      keyExtractor={(event) => event?.id}
      estimatedItemSize={400}
      extraData={theme}
      onEndReached={() => {}}
      onEndReachedThreshold={0.5}
    />
  );
};

const TabTwoScreen = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { currentProfile } = useNostr();
  const pagerRef = useRef(null);
  const [selectedTab, setSelectedTab] = useState('Notifications');
  const tabs = useMemo(() => ['Notifications'], []);

  const since = useMemo(() => Math.floor(Date.now() / 1000), []);
  const day = useMemo(() => 24 * 60 * 60, []);

  const followsFilter = useMemo(
    () => ({
      authors: [currentProfile?.pubkey],
      kinds: [EventKind.ContactList],
    }),
    [currentProfile?.pubkey]
  );

  const { events } = useSubscribe({ filters: followsFilter });
  const filters = useMemo(
    () => ({
      Notifications: [
        {
          kinds: [EventKind.TextNote, EventKind.Repost, 30023],
          authors: ['1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2'],
          '#t': ['sovran'],
        },
      ],
    }),
    [events, since, day]
  );

  const onPageSelected = useCallback(
    (event) => {
      const pageIndex = event.nativeEvent.position;
      setSelectedTab(tabs[pageIndex]);
    },
    [tabs]
  );

  const handleTabPress = useCallback((tab, index) => {
    setSelectedTab(tab);
    pagerRef.current?.setPage(index);
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
            <Feed theme={theme} filters={filters[tab]} />
          </View>
        ))}
      </PagerView>
    </View>
  );
};

const createStyles = (theme: string) =>
  StyleSheet.create({
    container: {
      backgroundColor: greys(theme)[2300],
      flex: 1,
      padding: 16,
    },
    loadingText: {
      color: greys(theme)[0],
      fontSize: 16,
      textAlign: 'center',
      marginTop: 20,
    },
    pagerView: {
      height: Dimensions.get('window').height,
      backgroundColor: 'transparent',
      marginLeft: -16,
      marginRight: -16,
      marginTop: 8,
    },
    pageContainer: {
      flex: 1,
      backgroundColor: greys(theme)[2300],
      height: '100%',
      overflow: 'hidden',
    },
  });

export default withSheetProvider(TabTwoScreen);
