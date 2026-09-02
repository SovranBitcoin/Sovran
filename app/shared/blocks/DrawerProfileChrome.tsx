/**
 * Drawer profile chrome: the top-of-drawer header. A single row with the
 * active-profile avatar on the left and the profile-switcher buttons on
 * the right, followed by display name / handle / follow counts. Owns its
 * own profile-domain wiring (profileStore reads, profileSwitcherPopup,
 * profileSessionOrchestrator, imported-nsec persistence) so the drawer
 * route file only orchestrates routes.
 */

import { useRef } from 'react';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as nip19 from 'nostr-tools/nip19';
import { withAlpha } from '@/shared/lib/color';

import Icon from 'assets/icons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useProfileDisplay } from '@/shared/hooks/useProfileDisplay';
import { useNostrProfile } from '@/shared/hooks/useNostrProfile';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { resolveIdentityName } from '@/shared/lib/identity';
import { profileSwitcherPopup, type ProfileSwitcherAction, staticPopup } from '@/shared/lib/popup';
import { storeImportedNsec } from '@/shared/lib/nostr/secureStorage';
import { truncateMiddle } from '@/shared/lib/strings';
import {
  createAndSwitchProfile,
  switchToExistingProfile,
  switchToImportedProfile,
} from '@/shared/lib/profile/profileSessionOrchestrator';
import { useProfileStore, type ProfileEntry } from '@/shared/stores/global/profileStore';
import { alpha, hitSlop, iconSize, radius, spacing } from '@/shared/styles/tokens';

const DRAWER_CLOSE_SETTLE_MS = 300;

function waitForDrawerClose(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DRAWER_CLOSE_SETTLE_MS));
}

function formatNip05Handle(nip05: string): string {
  if (nip05.startsWith('_@')) return `@${nip05.slice(2)}`;
  return `@${nip05}`;
}

function useProfileSwitcher(closeDrawer: () => void) {
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);
  const switchingRef = useRef(false);

  const executeProfileAction = async (action: ProfileSwitcherAction) => {
    if (switchingRef.current) return;
    switchingRef.current = true;

    closeDrawer();
    await waitForDrawerClose();

    switch (action.type) {
      case 'switch': {
        if (action.accountIndex === activeAccountIndex) {
          switchingRef.current = false;
          return;
        }
        const switched = await switchToExistingProfile({ accountIndex: action.accountIndex });
        if (!switched) {
          switchingRef.current = false;
          staticPopup('wallet-still-loading');
        }
        break;
      }
      case 'create': {
        const created = await createAndSwitchProfile();
        if (!created) switchingRef.current = false;
        break;
      }
      case 'import': {
        // Every bail here releases `switchingRef`. It is the re-entry guard
        // for this whole handler, so one that returns while holding it makes
        // every later profile action a silent no-op for as long as the drawer
        // stays mounted.
        if (useProfileStore.getState().hasPubkey(action.pubkeyHex)) {
          staticPopup('key-import-failed', {
            text: 'This identity already exists as a profile.',
          });
          switchingRef.current = false;
          return;
        }

        const stored = await storeImportedNsec(action.pubkeyHex, action.nsec);
        if (!stored) {
          staticPopup('key-import-failed', { text: 'Failed to store nsec securely.' });
          switchingRef.current = false;
          return;
        }

        if (
          !useProfileStore.getState().hasPubkey(action.pubkeyHex) &&
          !useProfileStore.getState().addProfile(action.accountIndex, action.pubkeyHex, 'imported')
        ) {
          // The nsec is already in SecureStore; without a profile row there is
          // nothing to switch to, so say so rather than switch into nothing.
          staticPopup('key-import-failed', { text: 'Profile limit reached.' });
          switchingRef.current = false;
          return;
        }

        const imported = await switchToImportedProfile({ accountIndex: action.accountIndex });
        if (!imported) {
          switchingRef.current = false;
          staticPopup('wallet-still-loading');
        }
        break;
      }
    }
  };

  const openSheet = () => {
    profileSwitcherPopup({
      onRequestAction: (action) => {
        void executeProfileAction(action);
      },
    });
  };

  return { executeProfileAction, openSheet };
}

// Container for the dots / "more profiles" button. The inactive avatar
// pressables don't use this — they sit bare in the row.
const dotsButtonStyle = {
  borderRadius: radius.pill,
  padding: 2,
  borderWidth: 2,
  borderColor: 'transparent',
} as const;

function ProfileSwitcherButtons({
  executeProfileAction,
  openSheet,
}: {
  executeProfileAction: (action: ProfileSwitcherAction) => Promise<void>;
  openSheet: () => void;
}) {
  const [foreground, defaultColor] = useThemeColor(['foreground', 'default'] as const);
  const profiles = useProfileStore((s) => s.profiles);
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);

  if (profiles.length === 0) return null;

  return (
    <HStack align="center" gap={spacing.md}>
      {profiles
        .filter((profile: ProfileEntry) => profile.accountIndex !== activeAccountIndex)
        .sort((a, b) => (a.source === 'imported' ? 0 : 1) - (b.source === 'imported' ? 0 : 1))
        .slice(0, 2)
        .map((profile: ProfileEntry) => (
          <Pressable
            key={profile.accountIndex}
            testID={`drawer-profile-switch-${profile.accountIndex}`}
            accessibilityRole="button"
            accessibilityLabel={`Switch account ${profile.accountIndex + 1}`}
            onPress={() => {
              void executeProfileAction({
                type: 'switch',
                accountIndex: profile.accountIndex,
              });
            }}>
            <Avatar
              state={profile.cachedPicture ? 'image' : 'fallback'}
              seed={profile.pubkey}
              picture={profile.cachedPicture}
              name={resolveIdentityName({
                pubkey: profile.pubkey,
                overrideName: profile.cachedDisplayName,
              })}
              size={30}
            />
          </Pressable>
        ))}
      <Pressable
        onPress={openSheet}
        testID="drawer-profile-switcher-open"
        accessibilityRole="button"
        accessibilityLabel="Switch profile"
        style={[dotsButtonStyle, { borderColor: defaultColor, backgroundColor: defaultColor }]}>
        <Icon name="tabler:dots" size={iconSize.xl} color={foreground} />
      </Pressable>
    </HStack>
  );
}

// Render-skip matters here: this 290-line chrome re-rendered inside the very
// commit native-stack gates push animations on (the drawer re-renders when
// useSegments flips). The React Compiler's element-identity memoization now
// provides the skip that React.memo used to — it holds as long as closeDrawer
// stays stable at the call site.
export function DrawerProfileChrome({ closeDrawer }: { closeDrawer: () => void }) {
  const { keys: nostrKeys } = useNostrKeysContext();
  const foreground = useThemeColor('foreground');
  const insets = useSafeAreaInsets();
  const pubkey = nostrKeys?.pubkey ?? '';
  const { displayName, picture } = useProfileDisplay(pubkey);
  const { metadata, isLoading: metaLoading } = useNostrProfileMetadata(pubkey || undefined);
  const { data: socialData, isLoading: socialLoading } = useNostrProfile(pubkey || null);
  // Mirror UserProfileScreen: own following count comes from the local kind-3
  // contacts store (with optimistic adjustments), not from the backend's
  // `follows` field — the backend's view of the wallet's own follows can lag.
  const ownFollowingCount = useNostrSocialStore((state) => {
    let count = Object.keys(state.followingPubkeys).length;
    for (const [followedPubkey, optimistic] of Object.entries(state.optimisticFollowsByPubkey)) {
      const baseIsFollowing = !!state.followingPubkeys[followedPubkey];
      if (optimistic.value === baseIsFollowing) continue;
      count += optimistic.value ? 1 : -1;
    }
    return Math.max(0, count);
  });
  const { isOffline } = useOfflineStatus();
  const { executeProfileAction, openSheet } = useProfileSwitcher(closeDrawer);

  const handleLine = metadata?.nip05
    ? formatNip05Handle(metadata.nip05)
    : pubkey
      ? truncateMiddle(nip19.npubEncode(pubkey), 8)
      : '';

  const mutedColor = withAlpha(foreground, alpha.disabled);

  const handleAvatarPress = () => {
    if (!nostrKeys?.pubkey) return;
    closeDrawer();
    router.navigate({
      pathname: '/(user-flow)/profile',
      params: { pubkey: nostrKeys.pubkey },
    });
  };

  if (!nostrKeys?.pubkey) {
    return <View style={{ paddingTop: isOffline ? 0 : insets.top }} />;
  }

  return (
    <View
      style={{
        paddingHorizontal: spacing['2xl'],
        paddingTop: (isOffline ? 0 : insets.top) + spacing.sm,
        paddingBottom: spacing.lg,
      }}>
      <HStack align="flex-start" justify="space-between">
        <Pressable onPress={handleAvatarPress} hitSlop={hitSlop.default}>
          <Avatar
            state={picture ? 'image' : 'fallback'}
            seed={nostrKeys.pubkey}
            picture={picture}
            name={displayName}
            size={56}
          />
        </Pressable>
        <ProfileSwitcherButtons executeProfileAction={executeProfileAction} openSheet={openSheet} />
      </HStack>
      <Spacer size={spacing.md} />
      <Pressable
        onPress={handleAvatarPress}
        testID="drawer-profile-name"
        accessibilityLabel={displayName}>
        <VStack align="flex-start" gap={spacing.xs}>
          <Text bold size={20} style={{ color: foreground }}>
            {displayName}
          </Text>
          <Text
            size={14}
            loading={metaLoading && !handleLine}
            placeholder="npub1abcdef…xyz"
            style={{ color: mutedColor }}
            numberOfLines={1}>
            {handleLine}
          </Text>
        </VStack>
      </Pressable>
      <Spacer size={spacing.md} />
      <HStack align="center" gap={spacing.lg}>
        <HStack align="baseline" gap={spacing.xs}>
          <Text bold size={14} style={{ color: foreground }}>
            {ownFollowingCount.toLocaleString()}
          </Text>
          <Text size={14} style={{ color: mutedColor }}>
            Following
          </Text>
        </HStack>
        <HStack align="baseline" gap={spacing.xs}>
          <Text
            bold
            size={14}
            loading={socialLoading && !socialData}
            placeholder="0000"
            style={{ color: foreground }}>
            {socialData ? socialData.followers.toLocaleString() : ''}
          </Text>
          <Text size={14} style={{ color: mutedColor }}>
            Followers
          </Text>
        </HStack>
      </HStack>
      <Spacer size={spacing.lg} />
    </View>
  );
}
