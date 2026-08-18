import { StyleSheet, View } from 'react-native';
import opacity from 'hex-color-opacity';

import { useThemeColor } from '@/shared/hooks/useThemeColor';

/**
 * Segmented posting progress bar shown at the bottom of the composer while a
 * post is uploading + publishing: one segment per image plus a final "post"
 * segment that fills when the first relay accepts the note (the remaining relays
 * fan out in the background). Upload is deferred to Post, so this only appears
 * once the user commits.
 */
export function PostProgressBar({
  done,
  total,
  failed = false,
}: {
  done: number;
  total: number;
  failed?: boolean;
}) {
  const [accent, danger, muted] = useThemeColor(['accent', 'danger', 'muted'] as const);
  const pending = opacity(muted, 0.25);
  const fill = failed ? danger : accent;

  return (
    <View style={styles.row} accessibilityLabel={`Posting ${done} of ${total}`}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[styles.seg, { backgroundColor: i < done ? fill : pending }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  seg: {
    flex: 1,
    height: 3,
    borderRadius: 2,
  },
});
