/**
 * The left drawer: a vertical account switcher (ADR 0035). One row per saved
 * profile with its cached name, picture and balance; the active one checked;
 * Add and Import at the end. It makes no network reads of its own.
 *
 * Every account action shares one lock. A switch or add ends in a restart (or
 * an in-process remount), so once one starts nothing else may run until the
 * app is on the other side; the tapped row shows a spinner meanwhile. A
 * refused action releases the lock.
 *
 * Popups open only after the drawer has finished closing: one opened over the
 * sliding drawer paints beneath it on iPhone.
 */

import { useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useDrawerProgress, type DrawerContentComponentProps } from 'expo-router/drawer';
import { setStringAsync } from 'expo-clipboard';

import Icon from 'assets/icons';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { resolveIdentityName } from '@/shared/lib/identity';
import { useCachedNostrProfile } from '@/shared/lib/nostr/useEntityCache';
import {
  actionMenuPopup,
  copyPopup,
  openProfileImportMenu,
  staticPopup,
  type ProfileImportRequest,
} from '@/shared/lib/popup';
import {
  createAndSwitchProfile,
  importAndSwitchProfile,
  switchToExistingProfile,
} from '@/shared/lib/profile/profileSessionOrchestrator';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useProfileStore, type ProfileEntry } from '@/shared/stores/global/profileStore';
import type { NostrProfileMetadata } from '@/shared/stores/global/nostrMetadataCache';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { PressScale } from '@/shared/ui/primitives/PressScale';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import {
  accountHandle,
  accountNpub,
  accountsCountLabel,
  formatCachedBalance,
  UNKNOWN_BALANCE,
} from './accountSwitcher';

type DrawerNavigation = DrawerContentComponentProps['navigation'];

/** Which action holds the lock, so its control shows the spinner. */
type Pending = { kind: 'switch'; accountIndex: number } | { kind: 'create' } | { kind: 'import' };

const PRESS_SCALE = 0.97;
/** Only a fallback: the wait normally ends when the drawer's progress reaches 0. */
const CLOSE_WAIT_FALLBACK_MS = 1000;

const IMPORT_REFUSALS = {
  exists: 'This identity already exists as a profile.',
  'key-not-stored': 'Failed to store nsec securely.',
  'key-mismatch': 'This key does not match the profile being added. Nothing was saved.',
  limit: 'Profile limit reached.',
} as const;

/**
 * Close the drawer and resolve once its slide has finished, read from the
 * drawer's own progress value rather than a guessed duration.
 */
function useCloseDrawerAndWait(navigation: DrawerNavigation) {
  const progress = useDrawerProgress();
  const waiters = useRef<(() => void)[]>([]);

  const flush = () => {
    const pending = waiters.current;
    waiters.current = [];
    for (const resolve of pending) resolve();
  };

  useAnimatedReaction(
    () => progress.get() <= 0.001,
    (closed, wasClosed) => {
      if (closed && wasClosed === false) scheduleOnRN(flush);
    }
  );

  return () =>
    new Promise<void>((resolve) => {
      if (progress.get() <= 0.001) {
        resolve();
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      waiters.current.push(done);
      setTimeout(done, CLOSE_WAIT_FALLBACK_MS);
      navigation.closeDrawer();
    });
}

type AccountRowProps = {
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

/** The drawer's row: reads the cached profile, then draws {@link AccountRow}. */
function CachedAccountRow(props: Omit<AccountRowProps, 'metadata' | 'activeProgress'>) {
  // Cache only: a profile seen before shows its name, picture and handle;
  // nothing is fetched. The saved name and picture still come first.
  const { metadata } = useCachedNostrProfile(props.profile.pubkey);
  return <AccountRow {...props} metadata={metadata} />;
}

function FooterAction({
  icon,
  label,
  testID,
  pending,
  locked,
  onPress,
}: {
  icon: string;
  label: string;
  testID: string;
  pending: boolean;
  locked: boolean;
  onPress: () => void;
}) {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: locked, busy: pending }}
      disabled={locked}
      activeOpacity={1}
      onPress={onPress}>
      <PressScale target={locked ? 1 : PRESS_SCALE}>
        <View
          className={`flex-row items-center gap-3 px-5 py-3 ${locked && !pending ? 'opacity-50' : ''}`}>
          <View className="bg-surface-secondary h-11 w-11 shrink-0 items-center justify-center rounded-full">
            {pending ? (
              <Spinner size={16} color={muted} />
            ) : (
              <Icon name={icon} size={20} color={foreground} />
            )}
          </View>
          <Text size={16} medium numberOfLines={1} accessible={false}>
            {label}
          </Text>
        </View>
      </PressScale>
    </Pressable>
  );
}

export function AccountSwitcherDrawer({ navigation }: { navigation: DrawerNavigation }) {
  const profiles = useProfileStore((s) => s.profiles);
  // The confirmed active account. The check follows it, never the tap.
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);
  const displayBtc = useSettingsStore((s) => s.displayBtc);
  const muted = useThemeColor('muted');
  const { isOffline } = useOfflineStatus();
  const closeDrawerAndWait = useCloseDrawerAndWait(navigation);

  const [pending, setPending] = useState<Pending | null>(null);
  // The state drives the spinner; the ref refuses a second tap in the same frame.
  const lockRef = useRef(false);

  const lock = (next: Pending): boolean => {
    if (lockRef.current) return false;
    lockRef.current = true;
    setPending(next);
    return true;
  };
  const release = () => {
    lockRef.current = false;
    setPending(null);
  };

  const handleSwitch = async (profile: ProfileEntry) => {
    if (profile.accountIndex === activeAccountIndex) {
      navigation.closeDrawer();
      return;
    }
    if (!lock({ kind: 'switch', accountIndex: profile.accountIndex })) return;
    void EnhancedHaptics.navigateHaptic();
    const switched = await switchToExistingProfile({ accountIndex: profile.accountIndex });
    if (!switched) {
      release();
      await closeDrawerAndWait();
      staticPopup('wallet-still-loading');
      return;
    }
    // An in-process switch has finished in this runtime; a restart never gets
    // here with the new account active, so the lock stays held through it.
    if (useProfileStore.getState().activeAccountIndex === profile.accountIndex) {
      release();
      navigation.closeDrawer();
    }
  };

  const handleCreate = async () => {
    if (!lock({ kind: 'create' })) return;
    void EnhancedHaptics.navigateHaptic();
    await closeDrawerAndWait();
    const created = await createAndSwitchProfile();
    if (!created) release();
  };

  const runImport = async (request: ProfileImportRequest) => {
    if (!lock({ kind: 'import' })) return;
    const result = await importAndSwitchProfile(request);
    if (result === 'switching') return;
    release();
    if (result === 'busy') staticPopup('wallet-still-loading');
    else staticPopup('key-import-failed', { text: IMPORT_REFUSALS[result] });
  };

  const handleImport = async () => {
    if (!lock({ kind: 'import' })) return;
    void EnhancedHaptics.navigateHaptic();
    await closeDrawerAndWait();
    // Not held while the form is open: closing it without importing must
    // leave every account action available.
    release();
    openProfileImportMenu({
      onImport: (request) => {
        void runImport(request);
      },
    });
  };

  const openAccountMenu = async (profile: ProfileEntry, name: string) => {
    if (lockRef.current) return;
    void EnhancedHaptics.navigateHaptic();
    const isActive = profile.accountIndex === activeAccountIndex;
    const npub = accountNpub(profile.pubkey);
    await closeDrawerAndWait();
    actionMenuPopup({
      title: name,
      buttons: [
        ...(npub
          ? [
              {
                text: 'Copy npub',
                icon: 'lets-icons:copy',
                testID: `drawer-profile-copy-npub-${profile.accountIndex}`,
                onPress: () => {
                  void setStringAsync(npub).then(
                    () => copyPopup('npub'),
                    () => staticPopup('copy-failed')
                  );
                },
              },
            ]
          : []),
        {
          text: 'View profile',
          icon: 'ri:user-3-line',
          testID: `drawer-profile-view-${profile.accountIndex}`,
          onPress: () => {
            router.navigate({
              pathname: '/(user-flow)/profile',
              params: { pubkey: profile.pubkey },
            });
          },
        },
        ...(isActive
          ? [
              {
                text: 'Edit profile',
                icon: 'mdi:pencil',
                testID: `drawer-profile-edit-${profile.accountIndex}`,
                onPress: () => {
                  router.navigate('/(settings-flow)/edit-profile');
                },
              },
            ]
          : []),
      ],
    });
  };

  const locked = pending !== null;

  return (
    <View className="bg-surface flex-1">
      <ScrollView
        className="flex-1"
        contentContainerClassName={`grow pb-safe-offset-4 ${isOffline ? 'pt-2' : 'pt-safe-offset-2'}`}
        showsVerticalScrollIndicator={false}>
        <View className="px-5 pb-3 pt-2" accessibilityRole="header">
          <Text size={28} bold numberOfLines={1}>
            Accounts
          </Text>
          <Text size={14} color={muted} numberOfLines={1}>
            {accountsCountLabel(profiles.length)}
          </Text>
        </View>
        {profiles.map((profile) => (
          <CachedAccountRow
            key={profile.accountIndex}
            profile={profile}
            isActive={profile.accountIndex === activeAccountIndex}
            isPending={pending?.kind === 'switch' && pending.accountIndex === profile.accountIndex}
            locked={locked}
            displayBtc={displayBtc}
            onPress={(p) => void handleSwitch(p)}
            onOpenMenu={(p, name) => void openAccountMenu(p, name)}
          />
        ))}
        <View className="pt-3">
          <FooterAction
            icon="la:user-plus"
            label="Add account"
            testID="drawer-add-account"
            pending={pending?.kind === 'create'}
            locked={locked}
            onPress={() => void handleCreate()}
          />
          <FooterAction
            icon="mdi:key-variant"
            label="Import account"
            testID="drawer-import-account"
            pending={pending?.kind === 'import'}
            locked={locked}
            onPress={() => void handleImport()}
          />
        </View>
      </ScrollView>
    </View>
  );
}
