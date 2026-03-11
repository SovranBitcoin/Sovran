import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { Avatar } from '@/shared/ui/primitives/Avatar';

type ContactListItemProps = {
  pubkey: string;
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
};

export const ContactListItem = ({
  pubkey,
  profile,
  subtitle,
  type = 'contact',
  mintInfo,
}: ContactListItemProps) => {
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);

  const displayName = useMemo(() => {
    if (type === 'mint' && mintInfo?.name) return mintInfo.name;
    return (
      profile?.displayName ||
      profile?.display_name ||
      profile?.name ||
      pubkey.slice(0, 12) + '...'
    );
  }, [profile, pubkey, type, mintInfo]);

  const avatarUrl = type === 'mint' ? mintInfo?.icon_url : profile?.picture;
  const displaySubtitle = subtitle || profile?.nip05 || pubkey.slice(0, 16) + '...';

  const handlePress = () => {
    router.navigate({
      pathname: '/(user-flow)/profile' as any,
      params: { pubkey },
    });
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.container,
        pressed && { backgroundColor: surfaceSecondary },
      ]}>
      <Avatar
        picture={avatarUrl}
        name={displayName}
        seed={pubkey}
        size={44}
      />
      <View style={styles.info}>
        <Text style={[styles.name, { color: foreground }]} numberOfLines={1}>
          {displayName}
        </Text>
        <Text
          style={[styles.handle, { color: opacity(foreground, 0.5) }]}
          numberOfLines={1}>
          {displaySubtitle}
        </Text>
      </View>
    </Pressable>
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
