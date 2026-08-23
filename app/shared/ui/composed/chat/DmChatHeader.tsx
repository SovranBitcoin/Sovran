import React, { useCallback, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import * as nip19 from 'nostr-tools/nip19';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { resolveIdentityName } from '@/shared/lib/identity';
import { truncateMiddle } from '@/shared/lib/strings';

interface DmChatHeaderProps {
  /**
   * Counterparty Nostr pubkey (hex). When provided, the header shows the
   * truncated npub subtitle and a QR-share button on the right. Set
   * `null`/omit for transports without a Nostr identity (e.g. BitChat BLE
   * peers) — the npub line and QR button are hidden.
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
  /** Optional custom subtitle. Overrides the default npub-truncated line. */
  subtitle?: string;
  onBack: () => void;
  /**
   * Replaces the right-hand QR-share button. Use when a transport needs a
   * different action (e.g. group settings sheet for a future MLS group).
   */
  trailing?: React.ReactNode;
}

/**
 * Header for 1:1 DM chat screens — avatar + display name + truncated npub +
 * QR-share button. Lifted from `features/user/screens/UserMessagesScreen.tsx`
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
  subtitle,
  onBack,
  trailing,
}: DmChatHeaderProps) {
  const { width: screenWidth } = useWindowDimensions();
  const headerTitleWidth = screenWidth - 124 - 24;

  const [foreground, surfaceSecondary, shade400] = useThemeColor([
    'foreground',
    'surface-secondary',
    'shade-400',
  ] as const);

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
        accessibilityLabel="Share profile QR"
      />
    ) : null);

  return (
    <Stack.Screen
      options={withGlassHeaderItems({
        headerShown: true,
        headerTransparent: false,
        headerStyle: { backgroundColor: surfaceSecondary },
        headerShadowVisible: false,
        headerBackVisible: false,
        headerTintColor: foreground,
        headerLeft: () => (
          <ScreenHeaderAction
            icon="material-symbols:arrow-back-rounded"
            onPress={onBack}
            accessibilityLabel="Go back"
          />
        ),
        headerTitle: () => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              width: headerTitleWidth,
              height: 48,
            }}>
            <Avatar
              state={shouldShowAvatarLoading ? 'loading' : userPicture ? 'image' : 'fallback'}
              size={40}
              picture={userPicture}
              seed={seed ?? pubkey ?? nickname ?? displayName}
              name={displayName}
            />
            <VStack
              gap={2}
              style={{
                marginLeft: 8,
                flex: 1,
                minWidth: 0,
                justifyContent: 'flex-start',
                alignItems: 'flex-start',
              }}>
              <Text
                loading={shouldShowAvatarLoading}
                placeholder="Display Name"
                size={16}
                bold
                style={{ color: foreground, textAlign: 'left' }}
                numberOfLines={1}>
                {displayName}
              </Text>
              {subtitle ? (
                <Text
                  size={12}
                  style={{ color: shade400, marginTop: 2, textAlign: 'left' }}
                  numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : npub ? (
                <Text
                  size={12}
                  style={{ color: shade400, marginTop: 2, textAlign: 'left' }}
                  numberOfLines={1}>
                  {truncateMiddle(npub, 8)}
                </Text>
              ) : null}
            </VStack>
          </View>
        ),
        headerRight: () => trailingNode,
      })}
    />
  );
}
