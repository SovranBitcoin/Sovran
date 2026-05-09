/**
 * Drawer profile chrome: the profile selector row + active-profile header card
 * that sits at the top of the drawer's content. Owns its own profile-domain
 * wiring (profileStore reads, profileSwitcherPopup, profileSessionOrchestrator,
 * imported-nsec persistence) so the drawer route file only orchestrates routes.
 */

import React, { useCallback, useRef } from 'react';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { resolveIdentityName } from '@/shared/lib/identity';
import { profileSwitcherPopup, type ProfileSwitcherAction, staticPopup } from '@/shared/lib/popup';
import { storeImportedNsec } from '@/shared/lib/nostr/secureStorage';
import {
  createAndSwitchProfile,
  switchToExistingProfile,
  switchToImportedProfile,
} from '@/shared/lib/profile/profileSessionOrchestrator';
import { useProfileStore, type ProfileEntry } from '@/shared/stores/global/profileStore';

const DRAWER_CLOSE_SETTLE_MS = 300;

function waitForDrawerClose(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DRAWER_CLOSE_SETTLE_MS));
}

function ProfileSelector({ closeDrawer }: { closeDrawer: () => void }) {
  const [foreground, defaultColor, shade400] = useThemeColor([
    'foreground',
    'default',
    'shade-400',
  ] as const);
  const profiles = useProfileStore((s) => s.profiles);
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);
  const switchingRef = useRef(false);

  const executeProfileAction = useCallback(
    async (action: ProfileSwitcherAction) => {
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
          if (useProfileStore.getState().hasPubkey(action.pubkeyHex)) {
            staticPopup('key-import-failed', {
              text: 'This identity already exists as a profile.',
            });
            return;
          }

          const stored = await storeImportedNsec(action.pubkeyHex, action.nsec);
          if (!stored) {
            staticPopup('key-import-failed', { text: 'Failed to store nsec securely.' });
            return;
          }

          if (!useProfileStore.getState().hasPubkey(action.pubkeyHex)) {
            useProfileStore
              .getState()
              .addProfile(action.accountIndex, action.pubkeyHex, 'imported');
          }

          const imported = await switchToImportedProfile({ accountIndex: action.accountIndex });
          if (!imported) {
            switchingRef.current = false;
            staticPopup('wallet-still-loading');
          }
          break;
        }
      }
    },
    [closeDrawer, activeAccountIndex]
  );

  const handleOpenProfileSheet = useCallback(() => {
    profileSwitcherPopup({
      onRequestAction: executeProfileAction,
    });
  }, [executeProfileAction]);

  if (profiles.length === 0) return null;

  return (
    <HStack
      align="center"
      spacing={4}
      style={{
        marginBottom: 16,
        paddingHorizontal: 4,
        paddingVertical: 4,
        borderRadius: 20,
        justifyContent: 'flex-end',
      }}>
      {profiles
        .filter((profile: ProfileEntry) => profile.accountIndex !== activeAccountIndex)
        .sort((a, b) => (a.source === 'imported' ? 0 : 1) - (b.source === 'imported' ? 0 : 1))
        .slice(0, 3)
        .map((profile: ProfileEntry) => {
          const isActive = profile.accountIndex === activeAccountIndex;
          return (
            <Pressable
              key={profile.accountIndex}
              onPress={() => {
                if (profile.accountIndex === activeAccountIndex) return;
                void executeProfileAction({
                  type: 'switch',
                  accountIndex: profile.accountIndex,
                });
              }}
              style={[
                profileAvatarButtonStyle,
                isActive && {
                  borderColor: shade400,
                  borderWidth: 2,
                },
              ]}>
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
          );
        })}
      <Pressable
        onPress={handleOpenProfileSheet}
        style={[
          profileAvatarButtonStyle,
          {
            borderColor: defaultColor,
            borderWidth: 2,
            backgroundColor: defaultColor,
          },
        ]}>
        <Icon name="tabler:dots" size={24} color={foreground} />
      </Pressable>
    </HStack>
  );
}

const profileAvatarButtonStyle = {
  borderRadius: 18,
  padding: 2,
  borderWidth: 2,
  borderColor: 'transparent',
  backgroundColor: 'rgba(255,255,255,0.05)',
} as const;

export function DrawerProfileChrome({ closeDrawer }: { closeDrawer: () => void }) {
  const { keys: nostrKeys } = useNostrKeysContext();
  const foreground = useThemeColor('foreground');
  const insets = useSafeAreaInsets();
  const { displayName, picture } = useProfileDisplay(nostrKeys?.pubkey || '');
  const { isOffline } = useOfflineStatus();

  const handlePress = useCallback(() => {
    if (nostrKeys?.pubkey) {
      closeDrawer();
      router.navigate({
        pathname: '/(user-flow)/profile',
        params: {
          pubkey: nostrKeys.pubkey,
        },
      });
    }
  }, [nostrKeys, closeDrawer]);

  return (
    <View style={{ padding: 16, paddingTop: isOffline ? 0 : insets.top }}>
      <View style={{ backgroundColor: 'transparent' }}>
        <ProfileSelector closeDrawer={closeDrawer} />
        <Pressable style={{ alignItems: 'center' }} onPress={handlePress}>
          {nostrKeys?.pubkey && (
            <VStack align="center" spacing={16}>
              <Avatar
                state={picture ? 'image' : 'fallback'}
                seed={nostrKeys?.pubkey}
                picture={picture}
                name={displayName}
                size={64}
              />
              <VStack align="center" spacing={8}>
                <Text bold size={20} style={{ textAlign: 'center', color: foreground }}>
                  {displayName}
                </Text>
                <Icon size={42} name="stash:qr-code" color={foreground} />
              </VStack>
            </VStack>
          )}
        </Pressable>
      </View>
      <Spacer size={58} />
    </View>
  );
}
