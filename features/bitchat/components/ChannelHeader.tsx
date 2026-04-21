import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';

interface ChannelHeaderProps {
  geohash: string;
  tierLabel?: string;
  isConnected: boolean;
  messageCount: number;
}

export const ChannelHeader = React.memo(function ChannelHeader({
  geohash,
  tierLabel,
  isConnected,
  messageCount,
}: ChannelHeaderProps) {
  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);

  return (
    <View style={[styles.container, { backgroundColor: surface }]}>
      <View style={styles.left}>
        <Text style={[styles.label, { color: foreground }]}>
          {tierLabel ? `${tierLabel} Chat` : `#${geohash}`}
        </Text>
        <Text style={[styles.geohash, { color: opacity(foreground, 0.5) }]}>
          #{geohash}
        </Text>
      </View>
      <View style={styles.right}>
        <Feather
          name={isConnected ? 'wifi' : 'wifi-off'}
          size={14}
          color={isConnected ? '#34C759' : opacity(foreground, 0.3)}
        />
        <Text style={[styles.meta, { color: opacity(foreground, 0.5) }]}>
          {messageCount} {messageCount === 1 ? 'msg' : 'msgs'}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  left: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
  geohash: {
    fontSize: 13,
    marginTop: 1,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  meta: {
    fontSize: 13,
  },
});
