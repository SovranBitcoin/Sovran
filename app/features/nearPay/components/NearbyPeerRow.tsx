import type { ReactNode } from 'react';
import type { BLEPeer } from 'bitchat-module';

import { peerIdentitySeed, peerNostrPubkey } from '@/features/nearPay/lib/peerProfile';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { ContactRow, bleIdentity, nostrIdentity } from '@/shared/ui/composed/ContactRow';

interface NearbyPeerRowProps {
  peer: BLEPeer;
  /** Replaces the default `#peerID · reachability` line. */
  subtitle?: string;
  /** Replaces the default reachability icon. */
  trailing?: ReactNode;
  onPress?: () => void;
  testID?: string;
}

/**
 * One nearby mesh peer in a list, with the face and name of the Nostr profile
 * it has handed us. A peer that has not exchanged identity (a stock BitChat
 * client never does) keeps its seeded silhouette and mesh nickname.
 *
 * Every list of nearby peers renders this row. Lists that built their own
 * passed only a seed and a nickname, so the same person had a face on the
 * radar and a silhouette in the list beside it.
 */
export function NearbyPeerRow({ peer, subtitle, trailing, onPress, testID }: NearbyPeerRowProps) {
  const pubkey = peerNostrPubkey(peer);
  const { metadata, isResolving } = useNostrProfileMetadata(pubkey ?? undefined);
  // The BLE identity leads, so the row keeps its mesh reachability; the Nostr
  // identity rides along and supplies the face and name.
  const ble = bleIdentity({ ...peer, identitySeed: peerIdentitySeed(peer) });
  const identity = pubkey
    ? [
        ble,
        nostrIdentity(pubkey, metadata, {
          // Hold the placeholder until the picture or the lookup lands, so the
          // row goes placeholder → face without a silhouette in between.
          isLoadingProfile: isResolving && !metadata?.picture,
        }),
      ]
    : ble;
  return (
    <ContactRow
      identity={identity}
      subtitle={subtitle}
      trailing={trailing}
      onPress={onPress}
      testID={testID}
    />
  );
}
