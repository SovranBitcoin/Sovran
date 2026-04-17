import React, { useMemo } from 'react';
import { Keyboard } from 'react-native';
import { router } from 'expo-router';

import { paymentLog, Log } from '@/shared/lib/logger';
import { ListRow } from '@/shared/ui/composed/ListRow';

type ContactListItemProps = {
  pubkey: string | null;
  profile?: {
    name?: string;
    displayName?: string;
    display_name?: string;
    picture?: string;
    nip05?: string;
  };
  subtitle?: string;
  type?: 'contact' | 'mint';
  mintInfo?: { icon_url?: string; name?: string };
  mintUrl?: string;
  isLoadingProfile?: boolean;
};

export const ContactListItem = ({
  pubkey,
  profile,
  subtitle,
  type = 'contact',
  mintInfo,
  mintUrl,
  isLoadingProfile = false,
}: ContactListItemProps) => {
  const pubkeyStr = pubkey ?? '';

  // Real display name only — no inline pubkey fallback. `titleFallback`
  // carries the abbreviated pubkey so the Text primitive swaps cleanly
  // between loading bar and real content without the pubkey flashing.
  const displayName = useMemo(() => {
    return (
      profile?.displayName ||
      profile?.display_name ||
      profile?.name ||
      (type === 'mint' && mintInfo?.name ? mintInfo.name : undefined)
    );
  }, [profile, type, mintInfo]);

  // Always prefer nostr profile picture; fall back to mint icon when unavailable.
  const avatarUrl = profile?.picture || mintInfo?.icon_url;
  const displaySubtitle = subtitle || profile?.nip05;

  const titleFallback = pubkeyStr.slice(0, 12) + '...';
  const subtitleFallback = pubkeyStr.slice(0, 16) + '...';

  const handlePress = () => {
    Keyboard.dismiss();
    if (!pubkeyStr) return;
    paymentLog.info('contact.item.press', { pubkey: pubkeyStr, type });
    router.navigate({
      pathname: '/(user-flow)/profile' as any,
      params: { pubkey: pubkeyStr, ...(mintUrl ? { mintUrl } : {}) },
    });
  };

  return (
    <Log name="ContactListItem">
      <ListRow
        avatar={{
          state: isLoadingProfile ? 'loading' : avatarUrl ? 'image' : 'fallback',
          picture: avatarUrl,
          name: displayName,
          seed: pubkeyStr,
          size: 44,
        }}
        title={displayName}
        titleFallback={titleFallback}
        subtitle={displaySubtitle}
        subtitleFallback={subtitleFallback}
        onPress={pubkeyStr ? handlePress : undefined}
        loading={isLoadingProfile}
        titlePlaceholder="Display Name"
        subtitlePlaceholder="user@relay.example"
      />
    </Log>
  );
};
