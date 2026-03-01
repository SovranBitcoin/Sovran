import React from 'react';
import { View } from 'react-native';

import Animated, {
  Extrapolation,
  interpolate,
  SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';

import Icon from 'assets/icons';
import { Text } from 'components/ui/Text';
import { OnboardingSlide } from './types';

type OnboardingSlideItemProps = {
  item: OnboardingSlide;
  index: number;
  width: number;
  scrollOffsetX: SharedValue<number>;
};

const OnboardingSlideItem: React.FC<OnboardingSlideItemProps> = ({
  item,
  index,
  width,
  scrollOffsetX,
}) => {
  const cardStyle = useAnimatedStyle(() => {
    const inputRange = [width * (index - 1), width * index, width * (index + 1)];

    const rotate = interpolate(scrollOffsetX.get(), inputRange, [2, 0, -2], Extrapolation.CLAMP);
    const translateY = interpolate(scrollOffsetX.get(), inputRange, [4, 0, 4], Extrapolation.CLAMP);

    return {
      transform: [{ translateY }, { rotate: `${rotate}deg` }],
    };
  }, [scrollOffsetX, index, width]);

  return (
    <Animated.View style={[{ width, paddingHorizontal: 28, paddingVertical: 20 }, cardStyle]}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
          borderRadius: 24,
          backgroundColor: item.bgColor,
          shadowColor: 'black',
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.25,
          shadowRadius: 3.84,
          elevation: 3,
          gap: 16,
        }}>
        <Icon name={item.icon} size={64} color="rgba(255,255,255,0.9)" />
        <Text bold size={28} style={{ color: 'white', textAlign: 'center' }}>
          {item.title}
        </Text>
        <Text size={15} style={{ color: 'rgba(255,255,255,0.8)', textAlign: 'center' }}>
          {item.description}
        </Text>
      </View>
    </Animated.View>
  );
};

export default OnboardingSlideItem;
