/**
 * Full-screen Instagram-style stories carousel with 3D cube-flip transitions.
 *
 * Ported from rn-makeitanimated, adapted to use expo-video and real nostr data.
 * Each "user" is a followed nostr account with video posts as their "stories".
 */

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  GestureResponderEvent,
  Pressable,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
  TouchableOpacity,
} from 'react-native';
import Animated, {
  SharedValue,
  useSharedValue,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  runOnJS,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEventListener } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';

import { Avatar } from 'components/ui/Avatar';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { StoriesContainer } from './StoriesContainer';
import { StoryProgressBar } from './StoryProgressBar';
import { easeGradient } from './easeGradient';
import type { ProfileInfo, VideoPostRecord } from './shared';

// ============================================================================
// Types
// ============================================================================

export interface StoryUser {
  pubkey: string;
  profile?: ProfileInfo;
  videoPosts: VideoPostRecord[];
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

  const scrollHandler = useAnimatedScrollHandler({
    onBeginDrag: () => {
      isDragging.set(true);
    },
    onScroll: (event) => {
      carouselPointerEvents.set('none');
      listAnimatedIndex.set(event.contentOffset.x / width);
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
    ({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
      if (viewableItems.length > 0 && viewableItems[0]?.index !== null) {
        setListCurrentIndex(viewableItems[0].index!);
      }
    },
    []
  );

  const viewabilityConfig = {
    itemVisiblePercentThreshold: 100,
    minimumViewTime: 0,
  };

  return (
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
      onScroll={scrollHandler}
      scrollEventThrottle={16}
      pagingEnabled
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged}
      decelerationRate="fast"
      style={rContainerStyle}
      getItemLayout={(_, index) => ({
        length: width,
        offset: width * index,
        index,
      })}
      initialScrollIndex={startIndex}
    />
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
      try {
        player.pause();
      } catch {
        // player may already be released
      }
    };
  }, [player]);

  useEffect(() => {
    if (isClosing) {
      try {
        player.pause();
      } catch {}
    }
  }, [isClosing, player]);

  // Track progress via expo-video time updates
  useEffect(() => {
    try {
      player.timeUpdateEventInterval = isActive ? 0.05 : 0;
    } catch {
      // player may have been released
    }
    return () => {
      try {
        player.timeUpdateEventInterval = 0;
      } catch {}
    };
  }, [isActive, player]);

  useEventListener(player, 'timeUpdate', () => {
    if (!isActive) return;
    try {
      const ct = player.currentTime ?? 0;
      const dur = player.duration ?? 0;
      if (dur > 0) storyProgress.set(ct / dur);
    } catch {}
  });

  // Reset and play when story or active state changes
  useEffect(() => {
    if (isActive) {
      storyProgress.set(0);
      try {
        player.currentTime = 0;
        player.play();
      } catch {}
    } else {
      try {
        player.pause();
      } catch {}
    }
  }, [currentStoryIndex, isActive, player, storyProgress]);

  // Handle video end → advance to next story or next user
  useEventListener(player, 'playToEnd', () => {
    if (!isActive || !mountedRef.current) return;
    if (currentStoryIndex < user.videoPosts.length - 1) {
      setCurrentStoryIndex(currentStoryIndex + 1);
    } else if (userIndex < totalUsers - 1) {
      scrollRef.current?.scrollToIndex({ index: userIndex + 1, animated: true });
    } else {
      // Pause player and delay close to avoid navigating during a render cycle
      try {
        player.pause();
      } catch {}
      setTimeout(() => {
        if (mountedRef.current) onClose?.();
      }, 150);
    }
  });

  // Pause/resume on drag
  const pausePlayer = useCallback(() => {
    try {
      player.pause();
    } catch {}
  }, [player]);

  const resumePlayer = useCallback(() => {
    try {
      player.play();
    } catch {}
  }, [player]);

  useAnimatedReaction(
    () => isDragging.get(),
    (current) => {
      if (current) {
        runOnJS(pausePlayer)();
      } else {
        if (userIndex === listCurrentIndex) {
          runOnJS(resumePlayer)();
        }
      }
    }
  );

  const onStoryPress = useCallback(
    (e: GestureResponderEvent) => {
      const screenX = e.nativeEvent.pageX;
      const isLeft = screenX < screenWidth / 2;
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
    try {
      player.pause();
    } catch {}
  }, [player]);

  const onStoryPressOut = useCallback(() => {
    if (isDragging.get()) return;
    try {
      player.play();
    } catch {}
  }, [isDragging, player]);

  const { colors: gradientColors, locations: gradientLocations } = easeGradient({
    colorStops: {
      0: { color: 'rgba(0,0,0,0.4)' },
      1: { color: 'rgba(0,0,0,0.0)' },
    },
  });

  const profileName = user.profile?.name || user.pubkey.slice(0, 12) + '…';
  const profilePicture = user.profile?.picture;

  return (
    <StoriesContainer listAnimatedIndex={listAnimatedIndex} userIndex={userIndex}>
      <Pressable
        style={styles.flex1}
        onPress={onStoryPress}
        onLongPress={onStoryLongPress}
        delayLongPress={250}
        onPressOut={onStoryPressOut}>
        {/* Video player — hide when closing so all VideoViews unmount before navigation */}
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

        {/* Top gradient overlay */}
        <LinearGradient
          colors={gradientColors}
          locations={gradientLocations}
          style={styles.topGradient}
        />
      </Pressable>

      {/* Header: progress bars + profile info */}
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
            picture={profilePicture}
            seed={user.pubkey}
            name={profileName}
            size={36}
            variant="person"
          />
          <Text size={14} bold style={[styles.profileName, styles.flex1]} numberOfLines={1}>
            {profileName}
          </Text>
          <TouchableOpacity
            onPress={() => {
              try {
                player.pause();
              } catch {}
              onClose?.();
            }}
            hitSlop={12}
            style={styles.closeButton}>
            <Icon name="mdi:close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
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
