import React, { useMemo } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { RefObject } from 'react';
import type { FlatList } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';

type FilterItemProps = {
  item: string;
  index: number;
  activeFilterItem: string;
  flatListRef: RefObject<FlatList<string> | null>;
  setActiveFilterItem: (item: string) => void;
};

const FilterItem = ({
  item,
  index,
  activeFilterItem,
  flatListRef,
  setActiveFilterItem,
}: FilterItemProps) => {
  const isActive = activeFilterItem === item;
  const isPressed = useSharedValue(false);
  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);

  // Pre-compute colors on JS thread so they can be used safely in worklets
  const pressedBg = useMemo(() => opacity(surfaceTertiary, 0.6), [surfaceTertiary]);
  const activeBg = useMemo(() => opacity(surfaceTertiary, 0.5), [surfaceTertiary]);

  const rStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: isPressed.get() ? pressedBg : 'rgba(0, 0, 0, 0)',
    };
  });

  return (
    <Pressable
      onPressIn={() => isPressed.set(true)}
      onPressOut={() => isPressed.set(false)}
      onPress={() => {
        setActiveFilterItem(item);
        flatListRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });
      }}
      style={[styles.pressable, isActive && { backgroundColor: activeBg }]}>
      <Animated.View style={[styles.inner, rStyle]}>
        {item === 'All filters' ? <Feather name="sliders" size={18} color={foreground} /> : null}
        <Text style={[styles.label, { color: foreground }]}>{item}</Text>
      </Animated.View>
    </Pressable>
  );
};

export default FilterItem;

const styles = StyleSheet.create({
  pressable: {
    borderRadius: 999,
    backgroundColor: 'transparent',
  },
  inner: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 999,
  },
  label: {
    fontSize: 17,
  },
});
