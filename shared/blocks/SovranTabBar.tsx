import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Pressable } from '@/shared/ui/primitives/Pressable';

export const SOVRAN_TAB_BAR_ROW_HEIGHT = 52;
/** Minimum bottom padding under the tab row when there's no home indicator. */
export const SOVRAN_TAB_BAR_MIN_BOTTOM_PADDING = 8;

type TabBarIcon = NonNullable<BottomTabBarProps['descriptors'][string]['options']['tabBarIcon']>;

type TabButtonProps = {
  focused: boolean;
  color: string;
  accessibilityLabel: string;
  testID: string | undefined;
  onPress: () => void;
  onLongPress: () => void;
  icon: TabBarIcon | undefined;
};

function TabButton({
  focused,
  color,
  accessibilityLabel,
  testID,
  onPress,
  onLongPress,
  icon,
}: TabButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const onPressIn = () => {
    scale.value = withTiming(0.88, {
      duration: 70,
      easing: Easing.out(Easing.cubic),
    });
  };

  const onPressOut = () => {
    scale.value = withSpring(1, {
      damping: 12,
      stiffness: 380,
      mass: 0.6,
    });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onLongPress={onLongPress}
      style={styles.tab}
      activeOpacity={1}
      hitSlop={8}>
      <Animated.View style={[styles.tabInner, animatedStyle]}>
        {icon ? icon({ focused, color, size: 26 }) : null}
      </Animated.View>
    </Pressable>
  );
}

export function SovranTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);

  const activeColor = foreground;
  const inactiveColor = opacity(foreground, 0.5);
  const dividerColor = opacity(foreground, 0.12);

  return (
    <View
      style={{
        backgroundColor: surface,
        paddingBottom: Math.max(insets.bottom, SOVRAN_TAB_BAR_MIN_BOTTOM_PADDING),
      }}>
      <View style={[styles.divider, { backgroundColor: dividerColor }]} />
      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const color = focused ? activeColor : inactiveColor;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          };

          const accessibilityLabel =
            options.tabBarAccessibilityLabel ?? options.title ?? route.name;

          return (
            <TabButton
              key={route.key}
              focused={focused}
              color={color}
              accessibilityLabel={accessibilityLabel}
              testID={options.tabBarButtonTestID}
              onPress={onPress}
              onLongPress={onLongPress}
              icon={options.tabBarIcon}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    height: SOVRAN_TAB_BAR_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    gap: 4,
  },
  tab: {
    flex: 1,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
