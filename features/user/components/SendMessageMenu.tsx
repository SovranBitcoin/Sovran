import React, { useMemo } from 'react';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { ActionMenuButton, type ActionMenuVariant } from '@/shared/ui/composed/ActionMenuButton';
import { useBLEPeers } from '@/features/bitchat/hooks/useBLEPeers';
import { useWhitenoiseSetup } from '@/features/whitenoise/hooks/useWhitenoiseSetup';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { buildProfileHref, useActiveProfileFlowGroup } from '@/shared/lib/nav/profileRoutes';
import Icon from 'assets/icons';
import { nostrLog } from '@/shared/lib/logger';

type Props = {
  pubkey: string;
  displayName: string;
  /** Button emphasis — profile footer renders it secondary beside Send Money. */
  variant?: 'primary' | 'secondary';
};

/**
 * Picker presented in place of the legacy single "Send Message" button on the
 * user profile screen. Mirrors the "as Ecash / as Lightning / as Onchain"
 * payment-method picker — same ActionMenuButton + bottom-sheet pattern.
 *
 * BitChat reachability is a heuristic nickname match against currently
 * connected BLE peers; there is no protocol-level npub ↔ peerID identity
 * proof yet (see brief, open question 5). When no match is found the option
 * is rendered as disabled with a "not in BLE range" reason instead of being
 * hidden, so the user understands it's a possible transport at all.
 */
export function SendMessageMenu({ pubkey, displayName, variant = 'primary' }: Props) {
  const { peers } = useBLEPeers();
  const { isReady: whitenoiseReady } = useWhitenoiseSetup();
  const whitenoiseEnabled = useSettingsStore((state) => state.whitenoiseEnabled);
  const profileFlowGroup = useActiveProfileFlowGroup();

  const bitchatPeer = useMemo(() => {
    if (!displayName) return undefined;
    const lower = displayName.trim().toLowerCase();
    if (!lower) return undefined;
    return peers.find((p) => p.isConnected && p.nickname.trim().toLowerCase() === lower);
  }, [peers, displayName]);

  const variants: ActionMenuVariant[] = useMemo(() => {
    const list: ActionMenuVariant[] = [
      {
        id: 'nostr',
        label: 'Nostr DM (NIP-17)',
        description: 'Encrypted (NIP-17 gift wrap)',
        icon: 'mdi:message-text',
        testID: 'send-message-menu-nostr',
        onPress: () => {
          nostrLog.info('user.profile.send_message', { pubkey, transport: 'nip17' });
          router.navigate(buildProfileHref('userMessages', { pubkey }, profileFlowGroup) as never);
        },
      },
      {
        id: 'nip04',
        label: 'Legacy DM (NIP-04)',
        description: 'Encrypted (NIP-04) — compatible with older clients',
        icon: 'mdi:message-outline',
        testID: 'send-message-menu-nip04',
        onPress: () => {
          nostrLog.info('user.profile.send_message', { pubkey, transport: 'nip04' });
          router.navigate(
            buildProfileHref(
              'userMessages',
              { pubkey, protocol: 'nip04' },
              profileFlowGroup
            ) as never
          );
        },
      },
    ];
    if (whitenoiseEnabled) {
      list.push({
        id: 'whitenoise',
        label: 'White Noise',
        description: whitenoiseReady
          ? 'MLS encrypted via Marmot'
          : 'Tap to set up MLS encrypted messaging',
        iconNode: <Icon name="internal:whitenoise" size={20} />,
        testID: 'send-message-menu-whitenoise',
        onPress: () => {
          nostrLog.info('user.profile.send_message', {
            pubkey,
            transport: 'whitenoise',
            ready: whitenoiseReady,
          });
          if (!whitenoiseReady) {
            router.push(buildProfileHref('whitenoiseSetup', undefined, profileFlowGroup) as never);
            return;
          }
          router.navigate(buildProfileHref('whitenoiseDM', { pubkey }, profileFlowGroup) as never);
        },
      });
    }
    list.push({
      id: 'bitchat',
      label: 'BitChat',
      description: bitchatPeer ? `Bluetooth mesh — nearby (matched by nickname)` : 'Bluetooth mesh',
      icon: 'mdi:bluetooth',
      isDisabled: !bitchatPeer,
      reason: bitchatPeer ? undefined : 'No nearby BLE peer matches this contact',
      testID: 'send-message-menu-bitchat',
      onPress: () => {
        if (!bitchatPeer) return;
        nostrLog.info('user.profile.send_message', {
          pubkey,
          transport: 'bitchat',
          peerID: bitchatPeer.peerID.slice(0, 8),
        });
        router.push(
          buildProfileHref(
            'bitchatDM',
            {
              transport: 'ble-dm',
              peerID: bitchatPeer.peerID,
              nickname: bitchatPeer.nickname,
            },
            profileFlowGroup
          ) as never
        );
      },
    });
    return list;
  }, [pubkey, whitenoiseEnabled, whitenoiseReady, bitchatPeer, profileFlowGroup]);

  return (
    <ActionMenuButton
      label="Send Message"
      variant={variant}
      testID="send-message-menu"
      variants={variants}
      menuTitle="Send via"
      presentation="bottom-sheet"
      collapsedPressOpensMenu
    />
  );
}
