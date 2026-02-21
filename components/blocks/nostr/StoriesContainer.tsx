/**
 * 3D cube-flip rotation wrapper for stories carousel.
 *
 * Ported from rn-makeitanimated instagram stories animation.
 * Active card rotates 0° → -90° (right pivot), next card rotates 90° → 0° (left pivot).
 */

import React, { FC, PropsWithChildren } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  SharedValue,
  useDerivedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';

const ANGLE = Platform.OS === 'android' ? 80 : 90;

type Props = {
  listAnimatedIndex: SharedValue<number>;
  userIndex: number;
};

export const StoriesContainer: FC<PropsWithChildren<Props>> = ({
  children,
  listAnimatedIndex,
  userIndex,
}) => {
  const { width: screenWidth } = useWindowDimensions();

  const listCurrentIndex = useDerivedValue(() => {
    return Math.floor(listAnimatedIndex.get());
  });

  const rContainerStyle = useAnimatedStyle(() => {
    const progress = listAnimatedIndex.get() - listCurrentIndex.get();

    const translateX =
      Platform.OS === 'android'
        ? interpolate(
            listAnimatedIndex.get(),
            [userIndex - 1, userIndex, userIndex + 1],
            [-8, 0, 8],
            Extrapolation.CLAMP
          )
        : 0;

    const scaleY = interpolate(
      listAnimatedIndex.get(),
      [userIndex - 1, userIndex, userIndex + 1],
      [0.98, 1, 0.98],
      Extrapolation.CLAMP
    );

    if (userIndex === listCurrentIndex.get()) {
      const rotateY = interpolate(progress, [0, 1], [0, -ANGLE], Extrapolation.CLAMP);
      return {
        transformOrigin: 'right',
        transform: [
          { perspective: screenWidth * 4 },
          { translateX },
          { scaleY },
          { rotateY: `${rotateY}deg` },
        ],
      };
    }

    if (userIndex === listCurrentIndex.get() + 1) {
      const rotateY = interpolate(progress, [0, 1], [ANGLE, 0], Extrapolation.CLAMP);
      return {
        transformOrigin: 'left',
        transform: [
          { perspective: screenWidth * 4 },
          { translateX },
          { scaleY },
          { rotateY: `${rotateY}deg` },
        ],
      };
    }

    return {};
  });

  return (
    <Animated.View style={[{ width: screenWidth }, rContainerStyle]}>{children}</Animated.View>
  );
};
