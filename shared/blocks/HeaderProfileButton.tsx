/**
 * Drawer-toggle button rendered as the active profile's avatar instead of
 * a hamburger icon. Used as `headerLeft` on the home, AI, and search-list
 * tabs. Reads the active pubkey from `NostrKeysProvider` and resolves the
 * picture/displayName via `useProfileDisplay` so it stays in sync with the
 * drawer chrome.
 */

import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, interpolate } from 'react-native-reanimated';
import { useDrawerProgress } from '@react-navigation/drawer';

import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useProfileDisplay } from '@/shared/hooks/useProfileDisplay';

const HEADER_BUTTON_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };
const AVATAR_SIZE = 32;

type HeaderProfileButtonProps = {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

export function HeaderProfileButton({ onPress, style }: HeaderProfileButtonProps) {
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey ?? '';
  const { displayName, picture } = useProfileDisplay(pubkey);
  // Drives in lockstep with the drawer overlay + scene border-shadow:
  // 0 = closed (visible), 1 = open (hidden).
  const progress = useDrawerProgress();

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, 0]),
  }));

  return (
    <Animated.View style={[animatedStyle, style]}>
      <Pressable
        onPress={onPress}
        hitSlop={HEADER_BUTTON_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel="Open drawer">
        <Avatar
          state={picture ? 'image' : 'fallback'}
          seed={pubkey}
          picture={picture}
          name={displayName}
          size={AVATAR_SIZE}
        />
      </Pressable>
    </Animated.View>
  );
}
