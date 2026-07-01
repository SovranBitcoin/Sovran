import React, { useEffect, useMemo } from 'react';
import { isSendTokenCancelled, getCounterparty } from 'wallet';
import { View } from '@/shared/ui/primitives/View/View';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import Icon from 'assets/icons';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { HistoryEntry } from '@cashu/coco-core';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useCachedNostrProfile } from '@/shared/lib/nostr/useEntityCache';
import { resolveIdentityName } from '@/shared/lib/identity';
import { Log, paymentLog } from '@/shared/lib/logger';

const ICON_SIZE = 28;

interface TransactionIconProps {
  historyEntry: HistoryEntry;
  /** Show a loading spinner instead of the icon */
  isLoading?: boolean;
}

export default function TransactionIcon({
  historyEntry,
  isLoading,
}: TransactionIconProps): React.ReactNode {
  const [foreground, surface, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface',
    'surface-secondary',
  ] as const);
  const cancelledSend = historyEntry.type === 'send' && isSendTokenCancelled(historyEntry);

  // Counterparty nostr identity (Nut Drop send/receive). When known, the avatar
  // replaces the center arrow, so the direction moves to the corner badge.
  const counterparty = getCounterparty(historyEntry);
  const counterpartyPubkey = counterparty?.pubkey;
  // Reactive but fetch-free read of the warm kind-0 cache, so the avatar fills
  // in if the profile is already cached and updates without per-row fetches.
  const { metadata: cachedProfile } = useCachedNostrProfile(counterpartyPubkey ?? '');
  const showAvatar = !isLoading && !!counterpartyPubkey;
  const avatarPicture = counterparty?.avatarUrl ?? cachedProfile?.picture;
  const avatarName =
    counterparty?.displayName ??
    (counterpartyPubkey
      ? resolveIdentityName({ pubkey: counterpartyPubkey, nostrProfile: cachedProfile })
      : undefined);

  const iconName = useMemo(() => {
    // Check if this is a rolled back send transaction
    if (cancelledSend) {
      return 'mdi:cancel'; // Cancelled/rolled back icon
    }

    switch (historyEntry.type) {
      case 'mint':
        return 'fluent:arrow-download-16-filled'; // Receiving from Lightning
      case 'melt':
        return 'fluent:arrow-upload-16-filled'; // Sending to Lightning
      case 'receive':
        return 'fluent:arrow-download-16-filled'; // Receiving ecash
      case 'send':
        return 'fluent:arrow-upload-16-filled'; // Sending ecash
      default:
        return 'fluent:circle-16-filled';
    }
  }, [cancelledSend, historyEntry.type]);

  // When the avatar replaces the center arrow, surface the transaction
  // direction in the corner badge.
  const showCornerBadge = !isLoading && showAvatar;

  useEffect(() => {
    paymentLog.debug('tx.icon.render', {
      type: historyEntry.type,
      state: String((historyEntry as { state?: unknown }).state ?? ''),
      isLoading: !!isLoading,
      cancelledSend,
      iconName,
      showAvatar,
      hasAvatarPicture: !!avatarPicture,
    });
  }, [cancelledSend, historyEntry, iconName, isLoading, showAvatar, avatarPicture]);

  return (
    <Log name="TransactionIcon">
      <View
        className="h-7 w-7 shrink-0 items-center justify-center bg-transparent"
        style={{ marginTop: 6 }}>
        {isLoading ? (
          <Spinner size={22} color={foreground} />
        ) : showAvatar ? (
          <Avatar
            state={avatarPicture ? 'image' : 'fallback'}
            picture={avatarPicture}
            seed={counterpartyPubkey}
            name={avatarName}
            size={ICON_SIZE}
          />
        ) : (
          <Icon name={iconName} color={foreground} size={24} />
        )}
        {showCornerBadge && (
          // Bottom-right badge over the icon/avatar. A slightly darker disc
          // (surface) with a ring matching the card fill (surface-secondary),
          // so it reads as a recessed chip on the card.
          <View
            style={{
              position: 'absolute',
              right: -3,
              bottom: -1,
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: surface,
              borderWidth: 1,
              borderColor: surfaceSecondary,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Icon name={iconName} color={foreground} size={10} />
          </View>
        )}
      </View>
    </Log>
  );
}
