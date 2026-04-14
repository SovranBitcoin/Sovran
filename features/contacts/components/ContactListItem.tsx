import React, { useMemo } from 'react';
import { View, Pressable, StyleSheet, Keyboard } from 'react-native';
import { router } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { paymentLog, Log } from '@/shared/lib/logger';

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
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);

  const pubkeyStr = pubkey ?? '';
  const displayName = useMemo(() => {
    return (
      profile?.displayName ||
      profile?.display_name ||
      profile?.name ||
      (type === 'mint' && mintInfo?.name) ||
      pubkeyStr.slice(0, 12) + '...'
    );
  }, [profile, pubkeyStr, type, mintInfo]);

  // Always prefer nostr profile picture; fall back to mint icon when unavailable
  const avatarUrl = profile?.picture || mintInfo?.icon_url;
  const displaySubtitle = subtitle || profile?.nip05 || pubkeyStr.slice(0, 16) + '...';

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
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [
          styles.container,
          pressed && { backgroundColor: surfaceSecondary },
        ]}>
        <Avatar
          picture={avatarUrl}
          name={displayName}
          seed={pubkeyStr}
          size={44}
          loading={isLoadingProfile}
        />
        <View style={styles.info}>
          <Text
            loading={isLoadingProfile}
            placeholder="Display Name"
            style={[styles.name, { color: foreground }]}
            numberOfLines={1}>
            {displayName}
          </Text>
          <Text
            loading={isLoadingProfile}
            placeholder="user@relay.example"
            style={[styles.handle, { color: opacity(foreground, 0.5) }]}
            numberOfLines={1}>
            {displaySubtitle}
          </Text>
        </View>
      </Pressable>
    </Log>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  handle: {
    fontSize: 14,
  },
});
