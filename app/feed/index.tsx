import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions } from 'react-native';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { FlashList } from '@shopify/flash-list';
import PagerView from 'react-native-pager-view';
import { Post } from 'components/blocks/feed';
import { VStack } from 'components/ui/View/VStack';
import { View } from 'components/ui/View/View';
import { Tabs } from 'components/ui/Tabs';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { useLocalSearchParams } from 'expo-router';
import { ShortTextNote, Repost } from 'nostr-tools/kinds';
import Container from '@/components/blocks/Container';

const Feed = ({ filters }: { filters: any }) => {
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
      extraData={sortedEvents.length}
      onEndReached={() => {}}
      onEndReachedThreshold={0.5}
    />
  );
};

const TabTwoScreen = () => {
  const { pubkey } = useLocalSearchParams<{ pubkey: string }>();
  const pagerRef = useRef(null);
  const [selectedTab, setSelectedTab] = useState('Feed');
  const tabs = useMemo(() => ['Feed'], []);

  const filters = useMemo(
    () => ({
      Feed: [
        {
          kinds: [ShortTextNote, Repost, 30023],
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
    <Container>
      <VStack className="flex-1 bg-primary-950 p-4">
        <View>
          <Tabs tabs={tabs} selectedTab={selectedTab} handleTabPress={handleTabPress} />
        </View>
        <PagerView
          ref={pagerRef}
          onPageSelected={onPageSelected}
          className="-mx-4 mt-2 h-screen"
          style={{ height: Dimensions.get('window').height }}
          initialPage={0}>
          {tabs.map((tab, index) => (
            <View key={index.toString()} className="h-full flex-1 overflow-hidden bg-primary-950">
              <Feed filters={filters[tab as keyof typeof filters]} />
            </View>
          ))}
        </PagerView>
      </VStack>
    </Container>
  );
};

export default withSheetProvider(TabTwoScreen);
