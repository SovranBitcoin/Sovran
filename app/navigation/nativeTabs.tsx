/**
 * Native tab bar and header components for Expo Router.
 * Uses expo-router/unstable-native-tabs and liquid glass on supported iOS devices.
 */

import React from 'react';
import { Platform, StyleProp, ViewStyle } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import type { NativeStackNavigationOptions } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';

import { withAlpha } from '@/shared/lib/color';
import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import Icon from 'assets/icons';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { HeaderGlassCircle } from '@/shared/ui/composed/HeaderGlassCircle';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { headerButtonSize } from '@/shared/styles/tokens';

type HeaderIconName = Extract<SymbolViewProps['name'], string>;

const ANDROID_HEADER_ICON_MAP: Partial<Record<HeaderIconName, string>> = {
  'clock.arrow.circlepath': 'mdi:clock-outline',
  'line.3.horizontal': 'mdi:menu',
  'wave.3.right': 'lucide:nfc',
  magnifyingglass: 'mingcute:search-3-line',
  xmark: 'material-symbols:close-rounded',
};

type HeaderIconButtonProps = {
  icon: HeaderIconName;
  color: string;
  onPress: () => void;
  size: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
};

/** Minimum 44pt touch target; hitSlop extends so taps near the edge still register. */
const HEADER_BUTTON_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

export function HeaderIconButton({
  icon,
  color,
  onPress,
  size,
  style,
  accessibilityLabel,
  testID,
}: HeaderIconButtonProps) {
  const [flatSurface, muted] = useThemeColor(['surface-secondary', 'muted'] as const);

  // Mint-selector chrome (the app-wide non-liquid-glass header-button
  // contract — see ScreenHeaderAction): surface-secondary circle, 1px muted
  // border, opacity press. Only the glyph source forks: SF symbol on iOS,
  // monicon map on Android (expo-symbols renders nothing there). On liquid
  // devices (iOS 26+) the app-owned HeaderGlassCircle replaces both the flat
  // chrome AND the system bar-item capsule (squat content-width pill) so
  // header buttons share the mint selector's glass geometry.
  const glyph =
    Platform.OS === 'android' ? (
      <Icon name={ANDROID_HEADER_ICON_MAP[icon] ?? 'mdi:menu'} size={size} color={color} />
    ) : (
      <IconSymbol name={icon} size={size} color={color} />
    );

  if (supportsLiquidGlass()) {
    // Forward the AX identity: HeaderGlassCircle is accessible only WITH a
    // label, so dropping it here left the button invisible to device tests.
    return (
      <HeaderGlassCircle onPress={onPress} testID={testID} accessibilityLabel={accessibilityLabel}>
        {glyph}
      </HeaderGlassCircle>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      hitSlop={HEADER_BUTTON_HIT_SLOP}
      activeOpacity={0.7}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          width: headerButtonSize,
          height: headerButtonSize,
          borderRadius: headerButtonSize / 2,
          backgroundColor: flatSurface,
          borderWidth: 1,
          borderColor: withAlpha(muted, 0.3),
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}>
      {glyph}
    </Pressable>
  );
}

type ExpoRouterHeaderScreenProps = {
  name: string;
  options?: NativeStackNavigationOptions;
  iconColor?: string;
  headerLeft?: NonNullable<NativeStackNavigationOptions['headerLeft']>;
  headerRight?: NonNullable<NativeStackNavigationOptions['headerRight']>;
  headerRightIcon?: HeaderIconName;
  onHeaderRightPress?: () => void;
  /** AX identity for the right icon button — required for the button to reach
   * the iOS accessibility tree (glass header buttons are otherwise id-less). */
  headerRightAccessibilityLabel?: string;
  headerRightTestID?: string;
};

type ExpoRouterHeaderOptionsInput = Omit<ExpoRouterHeaderScreenProps, 'name'>;

/**
 * Build Stack.Screen options with Android-safe headerLeft/headerRight behavior.
 * Use this with a direct `<Stack.Screen options={...} />`.
 */
export function buildExpoRouterHeaderOptions({
  options,
  iconColor,
  headerLeft,
  headerRight,
  headerRightIcon,
  onHeaderRightPress,
  headerRightAccessibilityLabel,
  headerRightTestID,
}: ExpoRouterHeaderOptionsInput): NativeStackNavigationOptions {
  const nextOptions: NativeStackNavigationOptions = {
    ...(options || {}),
  };
  const resolvedIconColor = iconColor ?? '#FFFFFF';

  if (Platform.OS === 'android') {
    nextOptions.headerShadowVisible = nextOptions.headerShadowVisible ?? false;
    nextOptions.headerTitleAlign = nextOptions.headerTitleAlign ?? 'center';
    const headerStyle = nextOptions.headerStyle || {};
    nextOptions.headerStyle = {
      ...headerStyle,
      backgroundColor:
        'backgroundColor' in headerStyle ? headerStyle.backgroundColor : 'transparent',
    };
    if (!nextOptions.headerTitle && !nextOptions.title) {
      nextOptions.headerTitle = '';
    }
  }

  const providedHeaderLeft = nextOptions.headerLeft ?? headerLeft;
  const providedHeaderRight = nextOptions.headerRight ?? headerRight;

  if (providedHeaderLeft) {
    nextOptions.headerLeft = providedHeaderLeft;
  }

  if (providedHeaderRight) {
    nextOptions.headerRight = providedHeaderRight;
  } else if (headerRightIcon && onHeaderRightPress) {
    nextOptions.headerRight = () => (
      <HeaderIconButton
        icon={headerRightIcon}
        color={resolvedIconColor}
        onPress={onHeaderRightPress}
        size={24}
        accessibilityLabel={headerRightAccessibilityLabel}
        testID={headerRightTestID}
      />
    );
  }

  return withGlassHeaderItems(nextOptions);
}

/**
 * Encapsulates Expo 55 NativeTabs availability checks.
 * Keep this in one place so future SDK changes only require one update.
 */
export const isExpo55NativeTabsSupported = () => Platform.OS === 'ios' && supportsLiquidGlass();

type Expo55NativeTabsProps = React.ComponentProps<typeof NativeTabs>;

/**
 * Wrapper around expo-router/unstable-native-tabs for centralized usage.
 */
function Expo55NativeTabsRoot(props: Expo55NativeTabsProps) {
  return <NativeTabs {...props} />;
}

export const Expo55NativeTabs = Object.assign(Expo55NativeTabsRoot, {
  Trigger: NativeTabs.Trigger,
});
