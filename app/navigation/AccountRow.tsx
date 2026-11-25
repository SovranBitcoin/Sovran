/**
 * One account in the drawer's switcher (ADR 0035): name on the first line,
 * balance (and handle, when there is one) on the second, the active one
 * highlighted and checked. Presentational, in its own module so the design
 * system can draw it without loading the drawer's stores and session code.
 */

import { useEffect } from 'react';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { resolveIdentityName } from '@/shared/lib/identity';
import type { ProfileEntry } from '@/shared/stores/global/profileStore';
import type { NostrProfileMetadata } from '@/shared/stores/global/nostrMetadataCache';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { PressScale } from '@/shared/ui/primitives/PressScale';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { accountHandle, formatCachedBalance, UNKNOWN_BALANCE } from './accountSwitcher';

/** A whole row is a big target: it presses only slightly. */
export const PRESS_SCALE = 0.97;

export type AccountRowProps = {
  profile: ProfileEntry;
  /** Kind-0 metadata already in the cache, if any. The row fetches nothing. */
  metadata: NostrProfileMetadata | undefined;
  isActive: boolean;
  isPending: boolean;
  locked: boolean;
  displayBtc: number;
  onPress: (profile: ProfileEntry) => void;
  /** Long press and the trailing button open the same account menu. */
  onOpenMenu: (profile: ProfileEntry, name: string) => void;
  /**
   * Drives the active highlight and check badge from outside (0 = plain row,
   * 1 = active), so a design-system scrubber can hold any frame. Omitted, the
   * row follows `isActive` on its own.
   */
  activeProgress?: SharedValue<number>;
};

/** The active highlight and check badge settle quickly; a switch is not a show. */
const ACTIVE_FADE_MS = 180;

/**
 * One account: name on the first line, balance (and handle, when there is
 * one) on the second. Presentational: everything it shows comes in as props.
 */
export function AccountRow({
  profile,
  metadata,
  isActive,
  isPending,
  locked,
  displayBtc,
  onPress,
  onOpenMenu,
  activeProgress,
}: AccountRowProps) {
  const [muted, accentForeground] = useThemeColor(['muted', 'accent-foreground'] as const);
  const reducedMotion = useReducedMotion();
  const ownProgress = useSharedValue(isActive ? 1 : 0);
  useEffect(() => {
    const target = isActive ? 1 : 0;
    ownProgress.set(reducedMotion ? target : withTiming(target, { duration: ACTIVE_FADE_MS }));
  }, [isActive, reducedMotion, ownProgress]);
  const progress = activeProgress ?? ownProgress;
  const highlightStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ scale: 0.6 + progress.get() * 0.4 }],
  }));

  const name = resolveIdentityName({
    pubkey: profile.pubkey,
    overrideName: profile.cachedDisplayName,
    nostrProfile: metadata,
  });
  const picture = profile.cachedPicture ?? metadata?.picture;
  const handle = accountHandle(metadata?.nip05);
  const balance = formatCachedBalance(profile.cachedBalanceSats, displayBtc);
  const balanceUnknown = balance === UNKNOWN_BALANCE;
  const dimmed = locked && !isPending;

  return (
    <View className={`mx-3 flex-row items-center ${dimmed ? 'opacity-50' : ''}`}>
      {/* The active account sits on an inset, rounded highlight. */}
      <Animated.View
        pointerEvents="none"
        className="bg-surface-secondary absolute inset-0 rounded-2xl"
        style={highlightStyle}
      />
      <Pressable
        testID={`drawer-profile-switch-${profile.accountIndex}`}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${balanceUnknown ? 'balance unknown' : balance}`}
        accessibilityHint={isActive ? 'Current account' : 'Switches to this account'}
        accessibilityState={{ selected: isActive, disabled: locked, busy: isPending }}
        disabled={locked}
        activeOpacity={1}
        onPress={() => onPress(profile)}
        onLongPress={() => onOpenMenu(profile, name)}
        className="min-w-0 flex-1">
        <PressScale target={locked ? 1 : PRESS_SCALE}>
          <View className="flex-row items-center gap-3 py-2.5 pl-2">
            {/* Fixed-size pieces never shrink; the text column takes what is left. */}
            <View className="shrink-0">
              <Avatar
                state={picture ? 'image' : 'fallback'}
                seed={profile.pubkey}
                picture={picture}
                name={name}
                size={44}
              />
              {/* Badge corner: the check on the active account, a spinner while switching. */}
              {isPending ? (
                <View className="bg-surface absolute -bottom-0.5 -right-0.5 h-5 w-5 items-center justify-center rounded-full">
                  <Spinner size={12} color={muted} />
                </View>
              ) : (
                <Animated.View
                  testID={isActive ? 'drawer-profile-active-badge' : undefined}
                  className="bg-accent border-surface-secondary absolute -bottom-0.5 -right-0.5 h-5 w-5 items-center justify-center rounded-full border-2"
                  style={badgeStyle}>
                  <Icon name="fluent:checkmark-16-filled" size={12} color={accentForeground} />
                </Animated.View>
              )}
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
              <Text size={16} semibold numberOfLines={1} accessible={false}>
                {name}
              </Text>
              <View className="min-w-0 flex-row items-center">
                {/* The balance never truncates; the handle gives way first. */}
                <Text
                  size={13}
                  className="shrink-0 tabular-nums"
                  color={balanceUnknown ? muted : undefined}
                  numberOfLines={1}
                  accessible={false}>
                  {balance}
                </Text>
                {handle ? (
                  <Text
                    size={13}
                    color={muted}
                    numberOfLines={1}
                    className="min-w-0 shrink"
                    accessible={false}>
                    {` · ${handle}`}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        </PressScale>
      </Pressable>
      {/* Sibling button so VoiceOver/TalkBack reaches Account options independently. */}
      <Pressable
        testID={`drawer-profile-options-${profile.accountIndex}`}
        accessibilityRole="button"
        accessibilityLabel="Account options"
        accessibilityHint={`Copy, view or edit ${name}`}
        accessibilityState={{ disabled: locked }}
        disabled={locked}
        hitSlop={4}
        onPress={() => onOpenMenu(profile, name)}
        className="h-11 w-11 shrink-0 items-center justify-center rounded-full">
        <Icon name="tabler:dots" size={20} color={muted} />
      </Pressable>
    </View>
  );
}
