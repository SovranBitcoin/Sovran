import React from 'react';
import { StyleSheet, View } from 'react-native';
import opacity from 'hex-color-opacity';
import Icon from '@/assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';

/**
 * Rounded pill tab used in the Feed/Notifications header filter rows and the
 * People/Posts search toggle (Feed + Contacts). Shared so the search scope
 * selector looks and behaves identically across surfaces.
 */
export function FeedTabButton({
  label,
  active,
  showChevron = false,
  onPress,
}: {
  label: string;
  active: boolean;
  showChevron?: boolean;
  onPress?: () => void;
}) {
  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);
  const activeBg = opacity(surfaceTertiary, 0.5);
  const pressedBg = opacity(surfaceTertiary, 0.65);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      haptics={!!onPress}
      activeOpacity={1}
      style={({ pressed }) => [
        styles.tabButton,
        { backgroundColor: pressed ? pressedBg : active ? activeBg : 'transparent' },
      ]}>
      <View style={styles.tabInner}>
        <Text style={[styles.tabLabel, { color: foreground }]}>{label}</Text>
        {showChevron ? <Icon name="mdi:chevron-down" size={16} color={foreground} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabButton: {
    borderRadius: 999,
  },
  tabInner: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tabLabel: {
    fontSize: 17,
  },
});
