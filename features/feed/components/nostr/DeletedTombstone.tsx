import React from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';

import Icon from '@/assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';

/**
 * Greyed placeholder shown in our OWN feed in place of a note we've requested
 * deletion for (NIP-09 kind:5 published). NIP-09 is a request, not a guarantee
 * — some relays may keep serving the note — so we deliberately keep a visible
 * tombstone rather than silently hiding it. Rendered by `PostCard` when
 * `selectIsDeleteRequested(event.id)` is true; replaces the full card across
 * every variant.
 */
export function DeletedTombstone({ inset = false }: { inset?: boolean }) {
  const foreground = useThemeColor('foreground');
  const muted = opacity(foreground, 0.4);
  const dimmed = opacity(foreground, 0.28);

  return (
    <Log name="DeletedTombstone">
      <View style={[styles.row, inset && styles.rowInset]} pointerEvents="none">
        <HStack align="center" gap={10}>
          <Icon name="mdi:trash-can-outline" size={18} color={dimmed} />
          <VStack style={styles.text}>
            <Text size={14} semibold style={{ color: muted }} numberOfLines={1}>
              Delete requested
            </Text>
            <Text size={12} style={{ color: dimmed }} numberOfLines={1}>
              May still appear on some relays
            </Text>
          </VStack>
        </HStack>
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  // Aligns with the gutter layout's text column (avatar width 36 + gap 12).
  rowInset: {
    paddingLeft: 16 + 36 + 12,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
});
