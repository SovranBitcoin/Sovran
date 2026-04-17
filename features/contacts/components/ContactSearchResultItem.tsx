import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { DisplayResult } from '@/features/payments/hooks/useContactSearch';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { Text } from '@/shared/ui/primitives/Text';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { paymentLog } from '@/shared/lib/logger';

type Props = {
  result: DisplayResult;
  loading: boolean;
};

export const ContactSearchResultItem = ({ result, loading }: Props) => {
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);

  const isLoading = loading || !result.profile;
  const profile = result.profile;
  const pubkey = result.pubkey;
  // Real display name only — no inline pubkey fallback (Text's `fallback`
  // prop owns that so we don't flash loading → pubkey → real name).
  const displayName = profile?.displayName || profile?.name;
  const hasNip05 = Boolean(profile?.nip05);

  const handlePress = () => {
    if (!result.profile) return;
    paymentLog.info('contact.search.result.press', { pubkey });
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
        pressed && !isLoading && { backgroundColor: surfaceSecondary },
      ]}>
      <Avatar
        state={isLoading ? 'loading' : profile?.picture ? 'image' : 'fallback'}
        picture={profile?.picture}
        seed={pubkey}
        size={44}
        name={displayName}
      />
      <View style={styles.info}>
        <Text
          loading={isLoading}
          placeholder="Display Name"
          fallback={pubkey.slice(0, 12) + '...'}
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
