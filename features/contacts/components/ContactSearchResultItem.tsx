import React from 'react';
import { View, Image, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { DisplayResult } from '@/features/payments/hooks/useContactSearch';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { Text } from '@/shared/ui/primitives/Text';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { paymentLog } from '@/shared/lib/logger';

type Props = {
  result: DisplayResult;
  loading: boolean;
  onPress: (result: DisplayResult) => void;
};

export const ContactSearchResultItem = ({ result, loading, onPress }: Props) => {
  const [foreground, surfaceSecondary, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface-secondary',
    'surface-tertiary',
  ] as const);

  const isLoading = loading || !result.profile;
  const profile = result.profile;
  const pubkey = result.pubkey;
  const displayName = profile
    ? profile.displayName || profile.name || pubkey.slice(0, 12) + '...'
    : '';
  const hasNip05 = Boolean(profile?.nip05);

  return (
    <Pressable
      onPress={() => {
        if (!isLoading) {
          paymentLog.info('contact.search.result.press', { pubkey: result.pubkey });
          onPress(result);
        }
      }}
      style={({ pressed }) => [
        styles.container,
        pressed && !isLoading && { backgroundColor: surfaceSecondary },
      ]}>
      {isLoading ? (
        <Avatar seed={pubkey} size={44} loading />
      ) : profile?.picture ? (
        <Image source={{ uri: profile.picture }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, { backgroundColor: surfaceTertiary }]}>
          <Feather name="user" size={20} color={opacity(foreground, 0.5)} />
        </View>
      )}
      <View style={styles.info}>
        <Text
          loading={isLoading}
          placeholder="Display Name"
          style={[styles.name, { color: foreground }]}
          numberOfLines={1}>
          {displayName}
        </Text>
        {hasNip05 ? (
          <View style={styles.nip05Row}>
            {profile!.nip05Valid && (
              <Feather name="check-circle" size={12} color={opacity(foreground, 0.4)} />
            )}
            <Text
              loading={isLoading}
              placeholder="user@relay.example"
              style={[styles.handle, { color: opacity(foreground, 0.5) }]}
              numberOfLines={1}>
              {profile!.nip05}
            </Text>
          </View>
        ) : (
          <Text
            loading={isLoading}
            placeholder="npub1..."
            style={[styles.handle, { color: opacity(foreground, 0.5) }]}
            numberOfLines={1}>
            {pubkey.slice(0, 16)}...
          </Text>
        )}
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
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  info: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  handle: {
    fontSize: 14,
  },
  nip05Row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
