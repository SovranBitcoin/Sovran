import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';

import Icon from '@/assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';

/** Matches PostCard's avatar so the tombstone lines up with real post rows. */
const AVATAR_SIZE = 36;

/**
 * Greyed placeholder shown in our OWN feed in place of a note we've requested
 * deletion for (NIP-09 kind:5 published). NIP-09 is a request, not a guarantee
 * — some relays may keep serving the note — so we deliberately keep a visible
 * tombstone rather than silently hiding it. Rendered by `PostCard` when
 * `selectIsDeleteRequested(event.id)` is true; replaces the full card.
 *
 * Styled as a post whose author avatar is a trash can — the same gutter layout
 * (avatar + text) as a real row, so a deleted post reads as "trashed" rather
 * than as a generic notice.
 */
export function DeletedTombstone() {
  const foreground = useThemeColor('foreground');
  const muted = opacity(foreground, 0.4);
  const dimmed = opacity(foreground, 0.3);
  const stubBg = opacity(foreground, 0.06);

  return (
    <Log name="DeletedTombstone">
      <View style={styles.row} pointerEvents="none">
        <HStack align="center" gap={12}>
          <View style={[styles.avatarStub, { backgroundColor: stubBg }]}>
            <Icon name="mdi:trash-can-outline" size={20} color={dimmed} />
          </View>
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
  // Mirrors PostCard's gutterRow (horizontal 16, vertical 10, gap 12).
  row: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  avatarStub: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
});
