import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Pressable } from '@/shared/ui/primitives/Pressable';

export const SOVRAN_TAB_BAR_ROW_HEIGHT = 52;
/** Minimum bottom padding under the tab row when there's no home indicator. */
export const SOVRAN_TAB_BAR_MIN_BOTTOM_PADDING = 8;

export function SovranTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [foreground, surface, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface',
    'surface-secondary',
  ] as const);

  const activeColor = foreground;
  const inactiveColor = opacity(foreground, 0.5);
  const dividerColor = opacity(foreground, 0.12);
  const pressedColor = opacity(foreground, 0.08);

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
          const tabBarIcon = options.tabBarIcon;

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={accessibilityLabel}
              testID={options.tabBarButtonTestID}
              onPress={onPress}
              onLongPress={onLongPress}
              style={({ pressed }) => [
                styles.tab,
                focused && { backgroundColor: surfaceSecondary },
                pressed && { backgroundColor: pressedColor },
              ]}
              activeOpacity={1}
              hitSlop={8}>
              {tabBarIcon ? tabBarIcon({ focused, color, size: 26 }) : null}
            </Pressable>
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
    borderRadius: 14,
    borderCurve: 'continuous',
  },
});
