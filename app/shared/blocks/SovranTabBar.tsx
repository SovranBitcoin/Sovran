import { useEffect } from 'react';
import { useReportTabBarHeight } from '@/shared/hooks/useScreenInsets';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Icon from 'assets/icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { withAlpha } from '@/shared/lib/color';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { PressScale } from '@/shared/ui/primitives/PressScale';
import { Text } from '@/shared/ui/primitives/Text';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';

/**
 * Icon + one label line. A minimum, not a fixed height: at large text sizes
 * the row grows with its label instead of clipping it.
 */
const SOVRAN_TAB_BAR_ROW_MIN_HEIGHT = 56;
/** Labels follow the person's text size up to 150%; past that the row would crowd. */
const TAB_LABEL_MAX_FONT_SCALE = 1.5;
/** Minimum bottom padding under the tab row when there's no home indicator. */
const SOVRAN_TAB_BAR_MIN_BOTTOM_PADDING = 8;
/** A whole tab is a big target: press it only slightly (Emil: 0.97 for cards). */
const TAB_PRESS_SCALE = 0.97;

/** The magnifier turns into a close mark while Search is open. */
const SEARCH_CLOSE_MS = 180;

type SearchTabIconProps = {
  focused: boolean;
  color: string;
  /**
   * Drives the magnifier → close crossfade from outside (0 = magnifier,
   * 1 = close), so a design-system scrubber can hold any frame. Omitted, the
   * icon follows `focused` on its own.
   */
  searchCloseProgress?: SharedValue<number>;
};

/** The Search tab's icon: a magnifier, and a close mark while Search is open. */
export function SearchTabIcon({ focused, color, searchCloseProgress }: SearchTabIconProps) {
  const reducedMotion = useReducedMotion();
  const ownProgress = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    const target = focused ? 1 : 0;
    ownProgress.set(
      reducedMotion
        ? target
        : withTiming(target, { duration: SEARCH_CLOSE_MS, easing: Easing.out(Easing.cubic) })
    );
  }, [focused, reducedMotion, ownProgress]);
  const progress = searchCloseProgress ?? ownProgress;

  const searchStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.get(),
    transform: [{ rotate: `${progress.get() * 90}deg` }, { scale: 1 - progress.get() * 0.25 }],
  }));
  const closeStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [
      { rotate: `${(progress.get() - 1) * 90}deg` },
      { scale: 0.75 + progress.get() * 0.25 },
    ],
  }));

  return (
    <View className="h-6 w-6">
      <Animated.View
        testID={focused ? undefined : 'tab-search-icon'}
        className="absolute inset-0 items-center justify-center"
        style={searchStyle}>
        {/* One glyph throughout: swapping to the filled one on focus would pop
            on the first frame of the close (and of the reopen). */}
        <Icon name="mingcute:search-3-line" color={color} size={24} />
      </Animated.View>
      <Animated.View
        testID={focused ? 'tab-search-close-icon' : undefined}
        className="absolute inset-0 items-center justify-center"
        style={closeStyle}>
        <Icon name="material-symbols:close-rounded" color={color} size={24} />
      </Animated.View>
    </View>
  );
}

type TabBarIcon = NonNullable<BottomTabBarProps['descriptors'][string]['options']['tabBarIcon']>;

type TabButtonProps = {
  focused: boolean;
  color: string;
  label: string;
  /** Read by screen readers in place of `label` when they differ. */
  accessibilityLabel?: string;
  testID: string | undefined;
  accessibilityHint?: string;
  onPress: () => void;
  onLongPress: () => void;
  icon: TabBarIcon | undefined;
};

function TabButton({
  focused,
  color,
  label,
  accessibilityLabel,
  testID,
  accessibilityHint,
  onPress,
  onLongPress,
  icon,
}: TabButtonProps) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      className="flex-1 items-center justify-center self-stretch py-1"
      activeOpacity={1}>
      <PressScale target={TAB_PRESS_SCALE}>
        <View className="items-center justify-center gap-0.5">
          {icon ? icon({ focused, color, size: 24 }) : null}
          <Text
            size={11}
            medium={focused}
            numberOfLines={1}
            maxFontSizeMultiplier={TAB_LABEL_MAX_FONT_SCALE}
            color={color}
            accessible={false}>
            {label}
          </Text>
        </View>
      </PressScale>
    </Pressable>
  );
}

type SovranTabBarProps = BottomTabBarProps & {
  /** A tab that closes when pressed while open, instead of staying put. */
  closeableRoute?: string;
  /** Leaves the open `closeableRoute` (back to the tab the person came from). */
  onCloseRoute?: () => void;
  /** Label for the open `closeableRoute`, e.g. "Close search". */
  closeLabel?: string;
  /** Where closing leads, read after the label, e.g. "Returns to Wallet". */
  closeHint?: string;
};

export function SovranTabBar({
  state,
  descriptors,
  navigation,
  closeableRoute,
  onCloseRoute,
  closeLabel,
  closeHint,
}: SovranTabBarProps) {
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
          const closes = focused && route.name === closeableRoute && onCloseRoute !== undefined;

          const onPress = () => {
            if (closes) {
              void EnhancedHaptics.navigateHaptic();
              onCloseRoute();
              return;
            }
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
              accessibilityLabel={closes ? closeLabel : undefined}
              accessibilityHint={closes ? closeHint : undefined}
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
    minHeight: SOVRAN_TAB_BAR_ROW_MIN_HEIGHT,
  },
});
