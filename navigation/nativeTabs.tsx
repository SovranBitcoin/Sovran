/**
 * Native tab bar and header components for Expo Router.
 * Uses expo-router/unstable-native-tabs and liquid glass on supported devices.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  InteractionManager,
  Pressable,
  Platform,
  StyleProp,
  Text,
  UIManager,
  View,
  ViewStyle,
  StyleSheet,
} from 'react-native';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { LiquidButtonView } from 'expo-liquid-glass-native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import Icon from 'assets/icons';
import { LIQUID_GLASS_ENABLED, supportsLiquidGlass } from '@/shared/lib/version';
import { Avatar } from '@/shared/ui/primitives/Avatar';

type HeaderIconName = string;
const INVISIBLE_TITLE_SHORT = '\u2007'.repeat(20);

const ANDROID_HEADER_ICON_MAP: Partial<Record<HeaderIconName, string>> = {
  'line.3.horizontal': 'mdi:menu',
  'wave.3.right': 'lucide:nfc',
  xmark: 'material-symbols:close-rounded',
};

export const hasAndroidLiquidButtonView = () => {
  if (!LIQUID_GLASS_ENABLED) return false;
  const config = UIManager?.getViewManagerConfig?.('LiquidButtonView');
  const hasConfig = (UIManager as any)?.hasViewManagerConfig?.('LiquidButtonView');
  return Boolean(config || hasConfig);
};

export const isAndroidLiquidHeaderSupported = () =>
  Platform.OS === 'android' && hasAndroidLiquidButtonView();

function useDeferredLiquidMount() {
  const [canMountLiquid, setCanMountLiquid] = useState(false);

  useEffect(() => {
    // ComposeView can crash if measured before being attached to a window.
    // Wait until navigation interactions complete, then mount on the next frame.
    const interaction = InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        setCanMountLiquid(true);
      });
    });
    return () => interaction.cancel();
  }, []);

  return canMountLiquid;
}

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
            backgroundColor: 'rgba(255,255,255,0.12)',
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

type AndroidLiquidHeaderButtonProps = {
  icon: HeaderIconName;
  color: string;
  onPress: () => void;
  size?: number;
};

/** Debounce ms so one tap doesn't fire both Pressable and LiquidButtonView. */
const LIQUID_BUTTON_DEBOUNCE_MS = 400;

function AndroidLiquidHeaderButton({
  icon,
  color,
  onPress,
  size = 22,
}: AndroidLiquidHeaderButtonProps) {
  const canMountLiquid = useDeferredLiquidMount();
  const lastPressAt = useRef(0);

  const handlePress = useCallback(() => {
    const now = Date.now();
    if (now - lastPressAt.current < LIQUID_BUTTON_DEBOUNCE_MS) return;
    lastPressAt.current = now;
    onPress();
  }, [onPress]);

  const androidIconName = ANDROID_HEADER_ICON_MAP[icon] ?? 'mdi:menu';
  return (
    <Pressable
      onPress={handlePress}
      hitSlop={HEADER_BUTTON_HIT_SLOP}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={{
          ...StyleSheet.absoluteFillObject,
          overflow: 'hidden',
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {canMountLiquid ? (
          <LiquidButtonView
            title={INVISIBLE_TITLE_SHORT}
            enabled
            tint="transparent"
            onPress={handlePress}
            blurRadius={2}
            lensX={12}
            lensY={24}
            style={StyleSheet.absoluteFillObject}
          />
        ) : (
          <View
            style={{
              ...StyleSheet.absoluteFillObject,
              backgroundColor: 'rgba(255,255,255,0.12)',
            }}
          />
        )}
      </View>
      <View pointerEvents="none" style={{ elevation: 1 }}>
        <Icon name={androidIconName} size={size} color={color} />
      </View>
    </Pressable>
  );
}

type AndroidLiquidHeaderTitleButtonProps = {
  width: number;
  lineOneText: string;
  lineTwoText: string;
  avatarName?: string;
  avatarPicture?: string;
  onPress?: () => void;
};

export function AndroidLiquidHeaderTitleButton({
  width,
  lineOneText,
  lineTwoText,
  avatarName,
  avatarPicture,
  onPress,
}: AndroidLiquidHeaderTitleButtonProps) {
  const canMountLiquid = useDeferredLiquidMount();
  const buttonWidth = Math.max(120, width);
  const buttonHeight = 44;
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: buttonWidth,
        height: buttonHeight,
        borderRadius: buttonHeight / 2,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {canMountLiquid ? (
        <LiquidButtonView
          title={INVISIBLE_TITLE_SHORT}
          enabled
          tint="transparent"
          useRealtimeCapture
          // lensX/lensY control lens radius, not X/Y displacement.
          blurRadius={2}
          lensX={12}
          lensY={24}
          onPress={onPress}
          style={{ width: buttonWidth, height: buttonHeight }}
        />
      ) : (
        <View
          style={{
            width: buttonWidth,
            height: buttonHeight,
            backgroundColor: 'rgba(255,255,255,0.12)',
          }}
        />
      )}
      <View pointerEvents="none" style={[styles.titleContent, { elevation: 1 }]}>
        <View style={styles.titleRow}>
          <View style={styles.titleAvatarWrap}>
            <Avatar size={20} name={avatarName} picture={avatarPicture} />
          </View>
          <View style={styles.titleTextGroup}>
            <Text numberOfLines={1} style={styles.titleTextPrimary}>
              {lineOneText}
            </Text>
            <Text numberOfLines={1} style={styles.titleTextSecondary}>
              {lineTwoText}
            </Text>
          </View>
          <View style={styles.titleChevronWrap}>
            <Icon name="fluent:chevron-down-12-filled" size={12} color="#FFFFFF" />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

type AndroidLiquidHeaderOverlayProps = {
  topInset: number;
  iconColor: string;
  leftIcon: HeaderIconName;
  onLeftPress: () => void;
  rightIcon: HeaderIconName;
  onRightPress: () => void;
  center?: React.ReactNode;
  centerWidth?: number;
};

export function AndroidLiquidHeaderOverlay({
  topInset,
  iconColor,
  leftIcon,
  onLeftPress,
  rightIcon,
  onRightPress,
  center,
  centerWidth,
}: AndroidLiquidHeaderOverlayProps) {
  if (!isAndroidLiquidHeaderSupported()) return null;

  return (
    <View pointerEvents="box-none" style={[styles.overlay, { top: topInset + 8 }]}>
      <View style={styles.overlayRow}>
        <AndroidLiquidHeaderButton
          icon={leftIcon}
          color={iconColor}
          onPress={onLeftPress}
          size={24}
        />
        <View style={[styles.overlayCenter, centerWidth ? { width: centerWidth } : null]}>
          {center}
        </View>
        <AndroidLiquidHeaderButton
          icon={rightIcon}
          color={iconColor}
          onPress={onRightPress}
          size={20}
        />
      </View>
    </View>
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

export type ExpoRouterHeaderOptionsInput = Omit<ExpoRouterHeaderScreenProps, 'name'>;

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
    nextOptions.headerStyle = {
      ...(nextOptions.headerStyle || {}),
      backgroundColor: 'transparent',
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

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 2000,
  },
  overlayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  overlayCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContent: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleAvatarWrap: {
    marginLeft: 8,
  },
  titleTextGroup: {
    flex: 1,
    justifyContent: 'center',
    marginHorizontal: 6,
  },
  titleChevronWrap: {
    marginRight: 8,
  },
  titleTextPrimary: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  titleTextSecondary: {
    color: '#FFFFFF',
    fontSize: 11,
    opacity: 0.9,
    fontWeight: '600',
    lineHeight: 13,
  },
});
