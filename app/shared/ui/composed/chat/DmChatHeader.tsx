import { useModerationActions } from '@/features/feed/hooks/useModerationActions';
import { HeaderHeightContext } from 'expo-router/react-navigation';

import { View } from '@/shared/ui/primitives/View/View';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import React, { useCallback, useContext, useMemo } from 'react';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import * as nip19 from 'nostr-tools/nip19';
import { IdentityBarTitle, IdentityNameBand } from '@/shared/ui/composed/IdentityHeader';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { zIndex } from '@/shared/styles/tokens';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { resolveIdentityName } from '@/shared/lib/identity';

interface DmChatHeaderProps {
  /**
   * Counterparty Nostr pubkey (hex). When provided, the header shows a
   * QR-share button (which carries the full npub) and the moderation menu on
   * the right. Omit for transports without a Nostr identity (e.g. BitChat BLE
   * peers) — both are hidden.
   */
  pubkey?: string;
  /**
   * Display-name override. When omitted, the header derives it from
   * `useNostrProfileMetadata(pubkey)` and falls back to a truncated pubkey
   * or the `nickname` if neither resolves.
   */
  displayName?: string;
  /**
   * Non-Nostr fallback identity (e.g. a BitChat advertised nickname).
   * Used as the avatar seed when no `pubkey` is provided.
   */
  nickname?: string;
  /**
   * Explicit avatar seed. When provided, takes precedence over the
   * `pubkey ?? nickname ?? displayName` fallback chain. Pass the same
   * identifier used by `ChatMessageBubble`'s `senderId` (e.g. BLE peerID)
   * so the header avatar matches in-thread message avatars.
   */
  seed?: string;
  onBack: () => void;
  /**
   * Replaces the right-hand QR-share button. Use when a transport needs a
   * different action (e.g. group settings sheet for a future MLS group).
   */
  trailing?: React.ReactNode;
}

/**
 * Header for 1:1 DM chat screens — the shared bar identity (the picture at
 * header-button size, name in the band beneath it) + QR-share button. Lifted from `features/user/screens/UserMessagesScreen.tsx`
 * (the non-Routstr DM path) so White Noise, BitChat-DM, and Nostr DMs all
 * present the same identity affordance. Internally renders a `<Stack.Screen>`
 * options block, so consumers just mount this component anywhere inside their
 * screen — no extra setup.
 */
export function DmChatHeader({
  pubkey,
  displayName: displayNameOverride,
  nickname,
  seed,
  onBack,
  trailing,
}: DmChatHeaderProps) {
  const { personMenu } = useModerationActions();
  const foreground = useThemeColor('foreground');
  const headerHeight = useContext(HeaderHeightContext) ?? 0;

  const { metadata, isLoading } = useNostrProfileMetadata(pubkey);

  const displayName = useMemo(
    () =>
      resolveIdentityName({
        pubkey,
        nostrProfile: metadata,
        bleNickname: nickname,
        overrideName: displayNameOverride,
      }),
    [displayNameOverride, metadata, nickname, pubkey]
  );

  const userPicture = metadata?.picture;
  const shouldShowAvatarLoading = !!pubkey && isLoading && !metadata;

  const npub = useMemo(() => {
    if (!pubkey) return null;
    try {
      return nip19.npubEncode(pubkey);
    } catch {
      return null;
    }
  }, [pubkey]);

  const handleShareQr = useCallback(() => {
    if (!npub) return;
    router.navigate({
      pathname: '/share',
      params: { type: 'profile', data: npub },
    });
  }, [npub]);

  const trailingNode =
    trailing ??
    (npub ? (
      <ScreenHeaderAction
        icon="stash:qr-code"
        size={20}
        onPress={handleShareQr}
        testID="dm-header-share"
        accessibilityLabel="Share profile QR"
      />
    ) : null);
  return (
    <>
      <Stack.Screen
        options={withGlassHeaderItems({
          headerShown: true,
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerShadowVisible: false,
          headerBackVisible: false,
          headerTintColor: foreground,
          headerLeft: () => (
            <ScreenHeaderAction
              icon="material-symbols:arrow-back-rounded"
              onPress={onBack}
              testID="dm-header-back"
              accessibilityLabel="Go back"
            />
          ),
          headerTitleAlign: 'center',
          headerTitle: () => (
            <IdentityBarTitle
              name={displayName}
              seed={seed ?? pubkey ?? nickname ?? displayName}
              picture={userPicture}
              isLoading={shouldShowAvatarLoading}
            />
          ),
          headerRight: () => (
            <HStack className="gap-1">
              {trailingNode}
              {pubkey && (
                <ScreenHeaderAction
                  icon="material-symbols:report-rounded"
                  testID="dm-header-moderation"
                  accessibilityLabel="Block or report person"
                  onPress={() => personMenu(pubkey)}
                />
              )}
            </HStack>
          ),
        })}
      />
      {/* The name the bar no longer has room for. A chat has no scroll handoff
          to fade it in, so it simply stays — the same chrome an identity page
          shows once collapsed, at the same place under the bar. */}
      {/* Sticky layer: this component is mounted BEFORE the chat list in every
          DM screen, so without it the first bubbles would paint over the name. */}
      <View
        pointerEvents="none"
        className="absolute left-0 right-0"
        style={{ top: headerHeight, zIndex: zIndex.sticky }}>
        <IdentityNameBand name={displayName} nameTestID="dm-header-title" />
      </View>
    </>
  );
}
