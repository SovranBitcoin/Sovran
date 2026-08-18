/**
 * Full-screen Instagram-style stories carousel with 3D cube-flip transitions.
 *
 * Ported from rn-makeitanimated, adapted to use expo-video and real nostr data.
 * Each "user" is a followed nostr account with video posts as their "stories".
 */

import React, { useCallback, useEffect, useRef, useState, type FC } from 'react';
import {
  FlatList,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import Animated, {
  useSharedValue,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  runOnJS,
  FadeIn,
  FadeOut,
  type SharedValue,
} from 'react-native-reanimated';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEventListener } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';

import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import Icon from 'assets/icons';
import { StoriesContainer } from './StoriesContainer';
import { StoryProgressBar } from './StoryProgressBar';
import { easeGradient } from '@/shared/lib/easeGradient';
import type { ProfileInfo, VideoPostRecord } from './feedTypes';
import { Log } from '@/shared/lib/logger';
import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';
import {
  remeasureVisualLayoutScope,
  useVisualListLogger,
  visualViewabilityRange,
} from '@/shared/lib/contentShiftLog';

// ============================================================================
// Types
// ============================================================================

export interface StoryUser {
  pubkey: string;
  profile?: ProfileInfo;
  videoPosts: VideoPostRecord[];
}

// ============================================================================
// Module-scope constants
// ============================================================================

const VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 100,
  minimumViewTime: 0,
};

const STORIES_VISUAL_SCOPE = 'feed.stories.carousel';

const TOP_GRADIENT = easeGradient({
  colorStops: {
    0: { color: 'rgba(0,0,0,0.4)' },
    1: { color: 'rgba(0,0,0,0.0)' },
  },
});

function safePlayerCall(player: ReturnType<typeof useVideoPlayer>, fn: (p: typeof player) => void) {
  try {
    fn(player);
  } catch {}
}

function storyVisualKey(user: StoryUser, index: number | null = null): string {
  return `story-user:${user.pubkey || (index == null ? 'unknown' : String(index))}`;
}

function storyVisualToken(token: ViewToken) {
  const item = token.item as StoryUser;
  const index = typeof token.index === 'number' ? token.index : null;
  return {
    index,
    key: typeof token.key === 'string' ? token.key : storyVisualKey(item, index),
    isViewable: token.isViewable,
    item,
    percentVisible: token.isViewable ? 100 : 0,
  };
}

// ============================================================================
// StoriesCarousel — top-level horizontal FlatList
// ============================================================================

interface CarouselProps {
  storyUsers: StoryUser[];
  startIndex?: number;
  onClose?: () => void;
  /** When true, VideoViews are not rendered so they unmount before navigation (avoids native crash). */
  isClosing?: boolean;
}

export const StoriesCarousel: FC<CarouselProps> = ({
  storyUsers,
  startIndex = 0,
  onClose,
  isClosing = false,
}) => {
  const [listCurrentIndex, setListCurrentIndex] = useState(startIndex);
  const { width } = useWindowDimensions();

  const scrollRef = useRef<FlatList<StoryUser> | null>(null);
  const listAnimatedIndex = useSharedValue(startIndex);
  const isDragging = useSharedValue(false);
  const carouselPointerEvents = useSharedValue<'auto' | 'none'>('auto');
  const lastReportedScrollX = useSharedValue(startIndex * width);
  const metricsRef = useRef({
    contentLength: storyUsers.length * width,
    scroll: startIndex * width,
    size: width,
  });
  const visualPhase = isClosing ? 'closing' : 'active';
  const {
    onMetricsChange: onVisualListMetricsChange,
    onViewableItemsChanged: onVisualViewableItemsChanged,
  } = useVisualListLogger<StoryUser>({
    scope: STORIES_VISUAL_SCOPE,
    surface: 'feed',
    component: 'StoriesCarouselFlatList',
    phase: visualPhase,
    extra: () => ({
      userCount: storyUsers.length,
      startIndex,
      listCurrentIndex,
      width,
    }),
    getItemKey: (user, index) => storyVisualKey(user, index),
    getItemContext: (user, index) => ({
      itemType: 'story-user',
      index,
      rowLabel: user.profile?.name ?? null,
      videoPosts: user.videoPosts.length,
    }),
  });
  const reportCarouselMetrics = useCallback(
    (reason: string) => {
      const metrics = metricsRef.current;
      onVisualListMetricsChange({
        reason,
        size: metrics.size,
        scroll: metrics.scroll,
        scrollLength: metrics.size,
        contentLength: metrics.contentLength,
      });
    },
    [onVisualListMetricsChange]
  );
  const reportCarouselScrollFromUI = useCallback(
    (scroll: number, size: number, contentLength: number) => {
      metricsRef.current = { contentLength, scroll, size };
      reportCarouselMetrics('scroll');
    },
    [reportCarouselMetrics]
  );

  const scrollHandler = useAnimatedScrollHandler({
    onBeginDrag: () => {
      isDragging.set(true);
    },
    onScroll: (event) => {
      carouselPointerEvents.set('none');
      listAnimatedIndex.set(event.contentOffset.x / width);
      const scroll = event.contentOffset.x;
      const size = event.layoutMeasurement.width || width;
      const contentLength = event.contentSize.width || storyUsers.length * width;
      if (Math.abs(scroll - lastReportedScrollX.get()) >= Math.max(32, width / 2)) {
        lastReportedScrollX.set(scroll);
        runOnJS(reportCarouselScrollFromUI)(scroll, size, contentLength);
      }
    },
    onMomentumEnd: () => {
      carouselPointerEvents.set('auto');
    },
    onEndDrag: () => {
      isDragging.set(false);
    },
  });

  const rContainerStyle = useAnimatedStyle(() => ({
    pointerEvents: Platform.OS === 'android' ? 'auto' : carouselPointerEvents.get(),
  }));

  const onViewableItemsChanged = useCallback(
    ({ viewableItems, changed }: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0]?.index !== null) {
        setListCurrentIndex(viewableItems[0].index!);
      }
      onVisualViewableItemsChanged({
        ...visualViewabilityRange([...viewableItems, ...changed]),
        viewableItems: viewableItems.map(storyVisualToken),
        changed: changed.map(storyVisualToken),
      });
    },
    [onVisualViewableItemsChanged]
  );
  const handleCarouselLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const size = event.nativeEvent.layout.width;
      metricsRef.current.size = size;
      metricsRef.current.contentLength = storyUsers.length * size;
      reportCarouselMetrics('layout');
    },
    [reportCarouselMetrics, storyUsers.length]
  );
  const handleCarouselContentSizeChange = useCallback(
    (contentWidth: number) => {
      metricsRef.current.contentLength = contentWidth;
      reportCarouselMetrics('content-size');
    },
    [reportCarouselMetrics]
  );
  const handleCarouselScrollSettled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      metricsRef.current = {
        contentLength: contentSize.width,
        scroll: contentOffset.x,
        size: layoutMeasurement.width,
      };
      reportCarouselMetrics('settled');
      remeasureVisualLayoutScope(STORIES_VISUAL_SCOPE, 'scroll-settled', {
        extra: {
          userCount: storyUsers.length,
          listCurrentIndex,
          isClosing,
        },
      });
    },
    [isClosing, listCurrentIndex, reportCarouselMetrics, storyUsers.length]
  );

  useEffect(() => {
    metricsRef.current = {
      contentLength: storyUsers.length * width,
      scroll: listCurrentIndex * width,
      size: width,
    };
    reportCarouselMetrics('state');
  }, [listCurrentIndex, reportCarouselMetrics, storyUsers.length, width]);

  return (
    <Log name="StoriesCarousel">
      <VisualLayoutProbe
        scope={STORIES_VISUAL_SCOPE}
        surface="feed"
        component="StoriesCarousel"
        itemKey="viewport"
        itemType="horizontal-flatlist"
        phase={isClosing ? 'closing' : 'active'}
        style={styles.flex1}
        extra={{
          userCount: storyUsers.length,
          startIndex,
          listCurrentIndex,
          width,
        }}>
        <Animated.FlatList
          ref={scrollRef as any}
          data={storyUsers}
          keyExtractor={(item) => item.pubkey}
          renderItem={({ item, index }) => (
            <UserStoriesItem
              user={item}
              userIndex={index}
              totalUsers={storyUsers.length}
              listAnimatedIndex={listAnimatedIndex}
              listCurrentIndex={listCurrentIndex}
              isDragging={isDragging}
              scrollRef={scrollRef}
              onClose={onClose}
              isClosing={isClosing}
            />
          )}
          horizontal
          showsHorizontalScrollIndicator={false}
          onLayout={handleCarouselLayout}
          onContentSizeChange={handleCarouselContentSizeChange}
          onScroll={scrollHandler}
          onScrollEndDrag={handleCarouselScrollSettled}
          onMomentumScrollEnd={handleCarouselScrollSettled}
          scrollEventThrottle={16}
          pagingEnabled
          viewabilityConfig={VIEWABILITY_CONFIG}
          onViewableItemsChanged={onViewableItemsChanged}
          decelerationRate="fast"
          style={[styles.flex1, rContainerStyle]}
          getItemLayout={(_, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
          initialScrollIndex={startIndex}
        />
      </VisualLayoutProbe>
    </Log>
  );
};

// ============================================================================
// UserStoriesItem — individual user card with video playback
// ============================================================================

type UserItemProps = {
  user: StoryUser;
  userIndex: number;
  totalUsers: number;
  listAnimatedIndex: SharedValue<number>;
  listCurrentIndex: number;
  isDragging: SharedValue<boolean>;
  scrollRef: React.RefObject<FlatList<StoryUser> | null>;
  onClose?: () => void;
  isClosing?: boolean;
};

const UserStoriesItem: FC<UserItemProps> = ({
  user,
  userIndex,
  totalUsers,
  listAnimatedIndex,
  listCurrentIndex,
  isDragging,
  scrollRef,
  onClose,
  isClosing = false,
}) => {
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const { width: screenWidth } = useWindowDimensions();
  const mountedRef = useRef(true);

  const isActive = userIndex === listCurrentIndex;
  const currentVideo = user.videoPosts[currentStoryIndex];
  const storyProgress = useSharedValue(0);

  const player = useVideoPlayer(currentVideo?.videoUrl ?? '', (p) => {
    p.loop = false;
    p.muted = false;
  });

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      safePlayerCall(player, (p) => p.pause());
    };
  }, [player]);

  useEffect(() => {
    if (isClosing) safePlayerCall(player, (p) => p.pause());
  }, [isClosing, player]);

  useEffect(() => {
    safePlayerCall(player, (p) => {
      p.timeUpdateEventInterval = isActive ? 0.05 : 0;
    });
    return () => {
      safePlayerCall(player, (p) => {
        p.timeUpdateEventInterval = 0;
      });
    };
  }, [isActive, player]);

  useEventListener(player, 'timeUpdate', () => {
    if (!isActive) return;
    safePlayerCall(player, (p) => {
      const ct = p.currentTime ?? 0;
      const dur = p.duration ?? 0;
      if (dur > 0) storyProgress.set(ct / dur);
    });
  });

  useEffect(() => {
    if (isActive) {
      storyProgress.set(0);
      safePlayerCall(player, (p) => {
        p.currentTime = 0;
        p.play();
      });
    } else {
      safePlayerCall(player, (p) => p.pause());
    }
  }, [currentStoryIndex, isActive, player, storyProgress]);

  useEventListener(player, 'playToEnd', () => {
    if (!isActive || !mountedRef.current) return;
    if (currentStoryIndex < user.videoPosts.length - 1) {
      setCurrentStoryIndex(currentStoryIndex + 1);
    } else if (userIndex < totalUsers - 1) {
      scrollRef.current?.scrollToIndex({ index: userIndex + 1, animated: true });
    } else {
      safePlayerCall(player, (p) => p.pause());
      setTimeout(() => {
        if (mountedRef.current) onClose?.();
      }, 150);
    }
  });

  const pausePlayer = useCallback(() => {
    safePlayerCall(player, (p) => p.pause());
  }, [player]);

  const resumePlayer = useCallback(() => {
    safePlayerCall(player, (p) => p.play());
  }, [player]);

  useAnimatedReaction(
    () => isDragging.get(),
    (current) => {
      if (current) {
        runOnJS(pausePlayer)();
      } else if (userIndex === listCurrentIndex) {
        runOnJS(resumePlayer)();
      }
    }
  );

  const onStoryPress = useCallback(
    (e: GestureResponderEvent) => {
      const isLeft = e.nativeEvent.pageX < screenWidth / 2;
      const isLastStory = currentStoryIndex === user.videoPosts.length - 1;
      const isFirstStory = currentStoryIndex === 0;

      if (isLeft) {
        if (userIndex === 0 && isFirstStory) return;
        if (isFirstStory) {
          scrollRef.current?.scrollToIndex({ index: userIndex - 1, animated: true });
        } else {
          setCurrentStoryIndex(currentStoryIndex - 1);
        }
      } else {
        if (userIndex === totalUsers - 1 && isLastStory) {
          onClose?.();
          return;
        }
        if (isLastStory) {
          scrollRef.current?.scrollToIndex({ index: userIndex + 1, animated: true });
        } else {
          setCurrentStoryIndex(currentStoryIndex + 1);
        }
      }
    },
    [
      currentStoryIndex,
      userIndex,
      totalUsers,
      scrollRef,
      screenWidth,
      user.videoPosts.length,
      onClose,
    ]
  );

  const onStoryLongPress = useCallback(() => {
    safePlayerCall(player, (p) => p.pause());
  }, [player]);

  const onStoryPressOut = useCallback(() => {
    if (isDragging.get()) return;
    safePlayerCall(player, (p) => p.play());
  }, [isDragging, player]);

  const handleClose = useCallback(() => {
    safePlayerCall(player, (p) => p.pause());
    onClose?.();
  }, [player, onClose]);

  const profileName = user.profile?.name || user.pubkey.slice(0, 12) + '…';
  const profilePicture = user.profile?.picture;
  const visualKey = `story:${userIndex}:${user.pubkey.slice(0, 12)}`;

  return (
    <StoriesContainer listAnimatedIndex={listAnimatedIndex} userIndex={userIndex}>
      <VisualLayoutProbe
        scope={STORIES_VISUAL_SCOPE}
        surface="feed"
        component="StoriesCarouselItem"
        itemKey={visualKey}
        itemType="story-user"
        index={userIndex}
        phase={isClosing ? 'closing' : isActive ? 'active' : 'inactive'}
        style={styles.flex1}
        extra={{
          currentStoryIndex,
          storyCount: user.videoPosts.length,
          active: isActive,
          hasVideo: !!currentVideo,
        }}>
        <Pressable
          style={styles.flex1}
          onPress={onStoryPress}
          onLongPress={onStoryLongPress}
          delayLongPress={250}
          onPressOut={onStoryPressOut}>
          <Animated.View
            key={currentVideo?.videoUrl}
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(200)}
            style={StyleSheet.absoluteFill}>
            {isClosing ? (
              <View
                style={[StyleSheet.absoluteFill, styles.videoRadius, styles.closingPlaceholder]}
              />
            ) : (
              <VideoView
                player={player}
                style={[StyleSheet.absoluteFill, styles.videoRadius]}
                contentFit="contain"
                nativeControls={false}
              />
            )}
          </Animated.View>

          <LinearGradient
            colors={TOP_GRADIENT.colors}
            locations={TOP_GRADIENT.locations}
            style={styles.topGradient}
          />
        </Pressable>

        <View style={styles.header} pointerEvents="box-none">
          <View style={styles.progressRow} pointerEvents="none">
            {user.videoPosts.map((_, idx) => (
              <StoryProgressBar
                key={idx}
                index={idx}
                currentStoryIndex={currentStoryIndex}
                storyProgress={storyProgress}
              />
            ))}
          </View>
          <View style={styles.profileRow} pointerEvents="box-none">
            <Avatar
              state={profilePicture ? 'image' : 'fallback'}
              picture={profilePicture}
              seed={user.pubkey}
              name={profileName}
              size={36}
            />
            <Text size={14} bold style={[styles.profileName, styles.flex1]} numberOfLines={1}>
              {profileName}
            </Text>
            <Pressable onPress={handleClose} hitSlop={12} style={styles.closeButton}>
              <Icon name="mdi:close" size={22} color="#fff" />
            </Pressable>
          </View>
        </View>
      </VisualLayoutProbe>
    </StoriesContainer>
  );
};

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  videoRadius: { borderRadius: 16 },
  closingPlaceholder: { backgroundColor: '#000' },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 200,
  },
  header: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileName: {
    color: '#fff',
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
