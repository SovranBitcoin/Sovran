/**
 * Drawer-toggle button rendered as the active profile's avatar instead of
 * a hamburger icon. Used as `headerLeft` on the home, AI, and search-list
 * tabs. Reads the active pubkey from `NostrKeysProvider` and resolves the
 * picture/displayName via `useProfileDisplay` so it stays in sync with the
 * drawer chrome.
 */

import React from 'react';
import { Platform, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, interpolate } from 'react-native-reanimated';
import { useDrawerProgress } from 'expo-router/drawer';

import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { HeaderGlassCircle } from '@/shared/ui/composed/HeaderGlassCircle';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useProfileDisplay } from '@/shared/hooks/useProfileDisplay';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { headerButtonSize } from '@/shared/styles/tokens';

const HEADER_BUTTON_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };
const ANDROID_BUTTON_SIZE = headerButtonSize;
const AVATAR_SIZE = 32;

type HeaderProfileButtonProps = {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

export function HeaderProfileButton({ onPress, style }: HeaderProfileButtonProps) {
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey ?? '';
  const { displayName, picture } = useProfileDisplay(pubkey);
  const [flatSurface, muted] = useThemeColor(['surface-secondary', 'muted'] as const);
  // Drives in lockstep with the drawer overlay + scene border-shadow:
  // 0 = closed (visible), 1 = open (hidden).
  const progress = useDrawerProgress();

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, 0]),
  }));

  // Mint-selector chrome on Android — matches the app-wide header-button
  // contract (ScreenHeaderAction / HeaderIconButton): surface-secondary
  // circle, 1px muted border. iOS renders the bare avatar inside the native
  // header chrome.
  const androidStyle =
    Platform.OS === 'android'
      ? {
          width: ANDROID_BUTTON_SIZE,
          height: ANDROID_BUTTON_SIZE,
          borderRadius: ANDROID_BUTTON_SIZE / 2,
          backgroundColor: flatSurface,
          borderWidth: 1,
          borderColor: opacity(muted, 0.3),
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
        }
      : null;

  const avatar = (
    <Avatar
      state={picture ? 'image' : 'fallback'}
      seed={pubkey}
      picture={picture}
      name={displayName}
      size={AVATAR_SIZE}
      fallbackVariant="beam"
    />
  );

  // Liquid devices: the same app-owned glass circle as every other header
  // button (the system bar-item capsule is suppressed app-wide via the
  // native-stack hidesSharedBackground patch — without this wrapper the
  // avatar would sit glass-less next to glass-circled siblings).
  if (supportsLiquidGlass()) {
    return (
      <Animated.View style={[animatedStyle, style]}>
        <HeaderGlassCircle onPress={onPress}>{avatar}</HeaderGlassCircle>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[animatedStyle, style]}>
      <Pressable
        onPress={onPress}
        hitSlop={HEADER_BUTTON_HIT_SLOP}
        style={androidStyle}
        accessibilityRole="button"
        accessibilityLabel="Open drawer">
        {avatar}
      </Pressable>
    </Animated.View>
  );
}
