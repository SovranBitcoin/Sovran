/**
 * Native tab bar and header components for Expo Router.
 * Uses expo-router/unstable-native-tabs and liquid glass on supported iOS devices.
 */

import React from 'react';
import { Platform, StyleProp, ViewStyle } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

import opacity from 'hex-color-opacity';
import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import Icon from 'assets/icons';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { headerButtonSize } from '@/shared/styles/tokens';

type HeaderIconName = string;

const ANDROID_HEADER_ICON_MAP: Partial<Record<HeaderIconName, string>> = {
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
}: HeaderIconButtonProps) {
  const [flatSurface, muted] = useThemeColor(['surface-secondary', 'muted'] as const);

  // Mint-selector chrome (the app-wide non-liquid-glass header-button
  // contract — see ScreenHeaderAction): surface-secondary circle, 1px muted
  // border, opacity press. Only the glyph source forks: SF symbol on iOS,
  // monicon map on Android (expo-symbols renders nothing there). On liquid
  // devices (iOS 26+) the system glass capsule around header bar items IS
  // the chrome — render the bare glyph; flat fill/border inside the capsule
  // gets refracted into a smeared double-glass look.
  const glyph =
    Platform.OS === 'android' ? (
      <Icon name={ANDROID_HEADER_ICON_MAP[icon] ?? 'mdi:menu'} size={size} color={color} />
    ) : (
      <IconSymbol name={icon as any} size={size} color={color} />
    );

  return (
    <Pressable
      onPress={onPress}
      hitSlop={HEADER_BUTTON_HIT_SLOP}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          width: headerButtonSize,
          height: headerButtonSize,
          borderRadius: headerButtonSize / 2,
          alignItems: 'center',
          justifyContent: 'center',
        },
        supportsLiquidGlass()
          ? null
          : {
              backgroundColor: flatSurface,
              borderWidth: 1,
              borderColor: opacity(muted, 0.3),
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
  headerLeftIcon?: HeaderIconName;
  onHeaderLeftPress?: () => void;
  headerLeftIconSize?: number;
  headerLeftStyle?: StyleProp<ViewStyle>;
  headerRightIcon?: HeaderIconName;
  onHeaderRightPress?: () => void;
  headerRightIconSize?: number;
  headerRightStyle?: StyleProp<ViewStyle>;
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
  headerLeftIcon,
  onHeaderLeftPress,
  headerLeftIconSize = 30,
  headerLeftStyle,
  headerRightIcon,
  onHeaderRightPress,
  headerRightIconSize = 24,
  headerRightStyle,
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
  } else if (headerLeftIcon && onHeaderLeftPress) {
    nextOptions.headerLeft = () => (
      <HeaderIconButton
        icon={headerLeftIcon}
        color={resolvedIconColor}
        onPress={onHeaderLeftPress}
        size={headerLeftIconSize}
        style={headerLeftStyle}
      />
    );
  }

  if (providedHeaderRight) {
    nextOptions.headerRight = providedHeaderRight;
  } else if (headerRightIcon && onHeaderRightPress) {
    nextOptions.headerRight = () => (
      <HeaderIconButton
        icon={headerRightIcon}
        color={resolvedIconColor}
        onPress={onHeaderRightPress}
        size={headerRightIconSize}
        style={headerRightStyle}
      />
    );
  }

  return nextOptions;
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
