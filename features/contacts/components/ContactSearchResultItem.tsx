import React, { useMemo } from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { DisplayResult } from '@/features/payments/hooks/useContactSearch';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';

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

  // Skeleton placeholder while loading
  if (loading || !result.profile) {
    return (
      <View style={styles.container}>
        <View
          style={[styles.skeletonAvatar, { backgroundColor: surfaceTertiary }]}
        />
        <View style={styles.info}>
          <View
            style={[
              styles.skeletonLine,
              { width: '60%', backgroundColor: surfaceTertiary },
            ]}
          />
          <View
            style={[
              styles.skeletonLine,
              { width: '40%', backgroundColor: surfaceTertiary },
            ]}
          />
        </View>
      </View>
    );
  }

  const { profile, pubkey } = result;
  const displayName =
    profile.displayName || profile.name || pubkey.slice(0, 12) + '...';

  return (
    <Pressable
      onPress={() => onPress(result)}
      style={({ pressed }) => [
        styles.container,
        pressed && { backgroundColor: surfaceSecondary },
      ]}>
      {profile.picture ? (
        <Image source={{ uri: profile.picture }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, { backgroundColor: surfaceTertiary }]}>
          <Feather name="user" size={20} color={opacity(foreground, 0.5)} />
        </View>
      )}
      <View style={styles.info}>
        <Text style={[styles.name, { color: foreground }]} numberOfLines={1}>
          {displayName}
        </Text>
        {profile.nip05 ? (
          <View style={styles.nip05Row}>
            {profile.nip05Valid && (
              <Feather
                name="check-circle"
                size={12}
                color={opacity(foreground, 0.4)}
              />
            )}
            <Text
              style={[styles.handle, { color: opacity(foreground, 0.5) }]}
              numberOfLines={1}>
              {profile.nip05}
            </Text>
          </View>
        ) : (
          <Text
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
  skeletonAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  info: {
    flex: 1,
    gap: 4,
  },
  skeletonLine: {
    height: 14,
    borderRadius: 4,
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
