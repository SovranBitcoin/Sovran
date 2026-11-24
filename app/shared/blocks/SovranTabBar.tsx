import { useReportTabBarHeight } from '@/shared/hooks/useScreenInsets';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { withAlpha } from '@/shared/lib/color';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { PressScale } from '@/shared/ui/primitives/PressScale';
import { Text } from '@/shared/ui/primitives/Text';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';

/** Icon + one label line; tall enough that a scaled label never clips. */
const SOVRAN_TAB_BAR_ROW_HEIGHT = 56;
/** Minimum bottom padding under the tab row when there's no home indicator. */
const SOVRAN_TAB_BAR_MIN_BOTTOM_PADDING = 8;
/** A whole tab is a big target: press it only slightly (Emil: 0.97 for cards). */
const TAB_PRESS_SCALE = 0.97;

type TabBarIcon = NonNullable<BottomTabBarProps['descriptors'][string]['options']['tabBarIcon']>;

type TabButtonProps = {
  focused: boolean;
  color: string;
  label: string;
  testID: string | undefined;
  onPress: () => void;
  onLongPress: () => void;
  icon: TabBarIcon | undefined;
};

function TabButton({ focused, color, label, testID, onPress, onLongPress, icon }: TabButtonProps) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      className="h-full flex-1 items-center justify-center"
      activeOpacity={1}>
      <PressScale target={TAB_PRESS_SCALE}>
        <View className="items-center justify-center gap-0.5">
          {icon ? icon({ focused, color, size: 24 }) : null}
          <Text
            size={11}
            medium={focused}
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            color={color}
            accessible={false}>
            {label}
          </Text>
        </View>
      </PressScale>
    </Pressable>
  );
}

export function SovranTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const reportHeight = useReportTabBarHeight();
  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);

  const activeColor = foreground;
  const inactiveColor = withAlpha(foreground, 0.5);
  const dividerColor = withAlpha(foreground, 0.12);

  return (
    <View
      onLayout={(event) => reportHeight?.(event.nativeEvent.layout.height)}
      accessibilityRole="tablist"
      style={{
        backgroundColor: surface,
        paddingBottom: Math.max(insets.bottom, SOVRAN_TAB_BAR_MIN_BOTTOM_PADDING),
      }}>
      <View style={[styles.divider, { backgroundColor: dividerColor }]} />
      <View className="flex-row items-center px-2" style={styles.row}>
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
              void EnhancedHaptics.navigateHaptic();
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          };

          const label = options.tabBarAccessibilityLabel ?? options.title ?? route.name;

          return (
            <TabButton
              key={route.key}
              focused={focused}
              color={color}
              label={label}
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
    height: SOVRAN_TAB_BAR_ROW_HEIGHT,
  },
});
