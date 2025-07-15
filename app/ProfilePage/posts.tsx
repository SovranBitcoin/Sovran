import React, { useRef, useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { Text, View, Animated, FlatList } from 'react-native';
import 'react-native-gesture-handler';

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Post, PostSkeleton } from './post';
import { useNostrEvents } from './helper';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { memoizedGetTheme } from 'helper/redux/settings';
dayjs.extend(relativeTime);

export const Posts = React.memo(({ mainPost = [], authors, ids, kinds, type }) => {
  const { posts, replies, media, fetchMore, loading, nextDateRange } = useNostrEvents(
    authors,
    ids,
    kinds,
    type
  );

  const events = {
    posts,
    replies,
    media,
  };

  const theme = useSelector(memoizedGetTheme);

  // Ref for opacity animation
  const opacity = useRef(new Animated.Value(1)).current;

  const renderItem = useCallback(({ item, index }) => {
    return <Post showNested={true} key={item.id} post={item} index={index} />;
  }, []);

  const data = useMemo(() => [...mainPost, ...events[type]], [mainPost, events, type]);

  // if (loading) {
  //   return <Text>Loading</Text>;
  // }

  return (
    <Animated.View style={{ opacity, flex: 1 }}>
      <FlatList
        data={data} // Already sorted in `fetchFeed`
        renderItem={renderItem}
        keyExtractor={(item, index) => index.toString()}
        ListEmptyComponent={
          <View
            style={{
              width: '100%',
              flex: 1,
              backgroundColor: greys(theme)[800],
            }}>
            <PostSkeleton />
          </View>
        }
        initialNumToRender={10} // Keep initialNumToRender as 10
        maxToRenderPerBatch={5} // Increase maxToRenderPerBatch to 5 for smoother scrolling
        windowSize={100}
      />
      {loading ? (
        <View
          style={{
            width: '100%',
            flex: 1,
            backgroundColor: greys(theme)[800],
          }}>
          <PostSkeleton />
        </View>
      ) : (
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <TouchableOpacity
            onPress={() => {
              fetchMore();
            }}
            style={{
              backgroundColor: greys(theme)[800],
              padding: 8,
              borderRadius: 8,
              marginTop: 16,
              marginBottom: 48,
              borderWidth: 1,
              borderColor: greys(theme)[700],
            }}>
            <Text
              style={{
                textAlign: 'center',
                fontFamily: 'OverpassBold',
                color: greys(theme)[400],
              }}>
              Load more from
            </Text>
            <Text
              style={{
                textAlign: 'center',
                fontFamily: 'OverpassRegular',
                color: greys(theme)[400],
              }}>
              {new Date(nextDateRange.since * 1000).toLocaleDateString('en-GB') +
                ' - ' +
                new Date(nextDateRange.until * 1000).toLocaleDateString('en-GB')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </Animated.View>
  );
});

Posts.displayName = 'Posts';
