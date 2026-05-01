import React, { useMemo } from 'react';
import { router } from 'expo-router';
import {
  ActionMenuButton,
  type ActionMenuVariant,
} from '@/shared/ui/composed/ActionMenuButton';
import { useBLEPeers } from '@/features/bitchat/hooks/useBLEPeers';
import { useWhitenoiseSetup } from '@/features/whitenoise/hooks/useWhitenoiseSetup';
import { MarmotIcon } from '@/features/whitenoise/components/MarmotIcon';
import { nostrLog } from '@/shared/lib/logger';

type Props = {
  pubkey: string;
  displayName: string;
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
export function SendMessageMenu({ pubkey, displayName }: Props) {
  const { peers } = useBLEPeers();
  const { isReady: whitenoiseReady } = useWhitenoiseSetup();

  const bitchatPeer = useMemo(() => {
    if (!displayName) return undefined;
    const lower = displayName.trim().toLowerCase();
    if (!lower) return undefined;
    return peers.find(
      (p) => p.isConnected && p.nickname.trim().toLowerCase() === lower
    );
  }, [peers, displayName]);

  const variants: ActionMenuVariant[] = useMemo(() => {
    const list: ActionMenuVariant[] = [
      {
        id: 'nostr',
        label: 'Nostr DM',
        description: 'Encrypted (NIP-17 gift wrap)',
        icon: 'mdi:message-text',
        testID: 'send-message-menu-nostr',
        onPress: () => {
          nostrLog.info('user.profile.send_message', { pubkey, transport: 'nostr' });
          router.navigate({
            pathname: '/(user-flow)/userMessages' as never,
            params: { pubkey },
          });
        },
      },
      {
        id: 'whitenoise',
        label: 'White Noise',
        description: whitenoiseReady
          ? 'MLS encrypted via Marmot'
          : 'Tap to set up MLS encrypted messaging',
        iconNode: <MarmotIcon size={20} />,
        testID: 'send-message-menu-whitenoise',
        onPress: () => {
          nostrLog.info('user.profile.send_message', {
            pubkey,
            transport: 'whitenoise',
            ready: whitenoiseReady,
          });
          if (!whitenoiseReady) {
            router.push('/(user-flow)/whitenoiseSetup' as never);
            return;
          }
          router.navigate({
            pathname: '/(user-flow)/whitenoiseDM' as never,
            params: { pubkey },
          });
        },
      },
      {
        id: 'bitchat',
        label: 'BitChat',
        description: bitchatPeer
          ? `Bluetooth mesh — nearby (matched by nickname)`
          : 'Bluetooth mesh',
        icon: 'mdi:bluetooth',
        isDisabled: !bitchatPeer,
        reason: bitchatPeer
          ? undefined
          : 'No nearby BLE peer matches this contact',
        testID: 'send-message-menu-bitchat',
        onPress: () => {
          if (!bitchatPeer) return;
          nostrLog.info('user.profile.send_message', {
            pubkey,
            transport: 'bitchat',
            peerID: bitchatPeer.peerID.slice(0, 8),
          });
          router.push({
            pathname: '/(user-flow)/bitchatDM' as never,
            params: {
              transport: 'ble-dm',
              peerID: bitchatPeer.peerID,
              nickname: bitchatPeer.nickname,
            },
          });
        },
      },
    ];
    return list;
  }, [pubkey, whitenoiseReady, bitchatPeer]);

  return (
    <ActionMenuButton
      label="Send Message"
      variant="primary"
      testID="send-message-menu"
      variants={variants}
      menuTitle="Send via"
      presentation="bottom-sheet"
      collapsedPressOpensMenu
    />
  );
}
