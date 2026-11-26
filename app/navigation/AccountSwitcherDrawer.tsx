/**
 * The left drawer: a vertical account switcher (ADR 0035). One row per saved
 * profile with its cached name, picture and balance; the active one checked;
 * Add and Import below a rule, as tinted buttons rather than avatar-like rows. It makes no network reads of its own.
 *
 * Every account action shares one lock. A switch or add ends in a restart (or
 * an in-process remount), so once one starts nothing else may run until the
 * app is on the other side; the tapped row shows a spinner meanwhile. A
 * refused action releases the lock.
 *
 * Popups open only after the drawer has finished closing: one opened over the
 * sliding drawer paints beneath it on iPhone.
 */

import { useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { useAnimatedReaction } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useDrawerProgress, type DrawerContentComponentProps } from 'expo-router/drawer';
import { setStringAsync } from 'expo-clipboard';

import Icon from 'assets/icons';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
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
import { useOfflineStatus } from '@/runtime/connectivity';
import { useProfileStore, type ProfileEntry } from '@/shared/stores/global/profileStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { PressScale } from '@/shared/ui/primitives/PressScale';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { accountNpub } from './accountSwitcher';
import { AccountRow, PRESS_SCALE, type AccountRowProps } from './AccountRow';

type DrawerNavigation = DrawerContentComponentProps['navigation'];

/** Which action holds the lock, so its control shows the spinner. */
type Pending = { kind: 'switch'; accountIndex: number } | { kind: 'create' } | { kind: 'import' };

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

/** The drawer's row: reads the cached profile, then draws {@link AccountRow}. */
function CachedAccountRow(props: Omit<AccountRowProps, 'metadata' | 'activeProgress'>) {
  // Cache only: a profile seen before shows its name, picture and handle;
  // nothing is fetched. The saved name and picture still come first.
  const { metadata } = useCachedNostrProfile(props.profile.pubkey);
  return <AccountRow {...props} metadata={metadata} />;
}

/**
 * Add or Import: a tinted, rounded button whose edges line up with the account
 * rows' highlight, so it reads as an action and not as one more account.
 */
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
          testID={`${testID}-surface`}
          className={`bg-default h-12 flex-row items-center gap-3 rounded-2xl px-4 ${locked && !pending ? 'opacity-50' : ''}`}>
          <View className="h-5 w-5 shrink-0 items-center justify-center">
            {pending ? (
              <Spinner size={16} color={muted} />
            ) : (
              <Icon name={icon} size={20} color={foreground} />
            )}
          </View>
          <Text size={15} medium numberOfLines={1} accessible={false}>
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
              pathname: '/profile',
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
        contentContainerClassName={`grow pb-safe-offset-4 ${isOffline ? 'pt-3' : 'pt-safe-offset-3'}`}
        showsVerticalScrollIndicator={false}>
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
        {/* Same mx-3 inset as the rows, so highlight and buttons share edges. */}
        <View className="bg-separator h-hairline mx-5 my-4" />
        <View className="mx-3 gap-2">
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
