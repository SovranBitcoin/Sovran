/**
 * Animated progress bar for story playback.
 *
 * Width interpolates from 0% → 100% based on a shared value driven by video playback.
 * Past stories show 100%, future stories show 0%.
 */

import React, { FC } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';

type Props = {
  index: number;
  currentStoryIndex: number;
  storyProgress: SharedValue<number>;
};

export const StoryProgressBar: FC<Props> = ({ index, currentStoryIndex, storyProgress }) => {
  const rBarStyle = useAnimatedStyle(() => {
    if (index < currentStoryIndex) {
      return { width: '100%' };
    }
    if (index > currentStoryIndex) {
      return { width: '0%' };
    }
    const widthValue = interpolate(storyProgress.get(), [0, 1], [0, 100], Extrapolation.CLAMP);
    return { width: `${widthValue}%` };
  });

  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, rBarStyle]} />
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    flex: 1,
    height: 2.5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#fff',
  },
});
