/**
 * Native tab bar and header components for Expo Router.
 * Uses expo-router/unstable-native-tabs and liquid glass on supported iOS devices.
 */

import React from 'react';
import { Platform, StyleProp, ViewStyle } from 'react-native';
import opacity from 'hex-color-opacity';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import Icon from 'assets/icons';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

type HeaderIconName = string;

const ANDROID_HEADER_ICON_MAP: Partial<Record<HeaderIconName, string>> = {
  'line.3.horizontal': 'mdi:menu',
  'wave.3.right': 'lucide:nfc',
  xmark: 'material-symbols:close-rounded',
};

type HeaderIconButtonProps = {
  icon: HeaderIconName;
  color: string;
  onPress: () => void;
  size: number;
  style?: StyleProp<ViewStyle>;
};

/** Minimum 44pt touch target; hitSlop extends so taps near the edge still register. */
const HEADER_BUTTON_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

function HeaderIconButton({ icon, color, onPress, size, style }: HeaderIconButtonProps) {
  const [flatSurface, muted] = useThemeColor(['surface-secondary', 'muted'] as const);

  if (Platform.OS === 'android') {
    const androidIconName = ANDROID_HEADER_ICON_MAP[icon];
    return (
      <Pressable
        onPress={onPress}
        hitSlop={HEADER_BUTTON_HIT_SLOP}
        style={[
          {
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: flatSurface,
            borderWidth: 1,
            borderColor: opacity(muted, 0.3),
            alignItems: 'center',
            justifyContent: 'center',
          },
          style,
        ]}>
        {androidIconName ? (
          <Icon name={androidIconName} size={size} color={color} />
        ) : (
          <Icon name="mdi:menu" size={size} color={color} />
        )}
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} hitSlop={HEADER_BUTTON_HIT_SLOP} style={[{ margin: 2 }, style]}>
      <IconSymbol name={icon as any} size={size} color={color} />
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
