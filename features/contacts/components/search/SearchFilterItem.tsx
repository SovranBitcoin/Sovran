import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import Icon from 'assets/icons';
import type { RefObject } from 'react';
import type { FlatList } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { Log } from '@/shared/lib/logger';

type FilterItemProps<F extends string> = {
  item: F;
  index: number;
  activeFilterItem: F;
  flatListRef: RefObject<FlatList<F> | null>;
  setActiveFilterItem: (item: F) => void;
};

function FilterItem<F extends string>({
  item,
  index,
  activeFilterItem,
  flatListRef,
  setActiveFilterItem,
}: FilterItemProps<F>) {
  const isActive = activeFilterItem === item;
  const isPressed = useSharedValue(false);
  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);

  // Pre-compute colors on JS thread so they can be used safely in worklets
  const pressedBg = opacity(surfaceTertiary, 0.6);
  const activeBg = opacity(surfaceTertiary, 0.5);

  const rStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: isPressed.get() ? pressedBg : 'rgba(0, 0, 0, 0)',
    };
  });

  return (
    <Log name="FilterItem">
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
          {item === 'All filters' ? (
            <Icon name="fluent:filter-16-filled" size={18} color={foreground} />
          ) : null}
          <Text style={[styles.label, { color: foreground }]}>{item}</Text>
        </Animated.View>
      </Pressable>
    </Log>
  );
}

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
