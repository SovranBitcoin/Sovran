/**
 * @fileoverview Composer header row: Cancel + Post buttons.
 *
 * Extracted from `PostComposer` as a pure presentational seam. The
 * `VisualLayoutProbe` keeps its original scope/component/itemKey strings so the
 * content-shift log taxonomy (`composer.*`) is unchanged.
 */
import { StyleSheet } from 'react-native';
import { Button } from 'heroui-native';

import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';
import { alpha, spacing } from '@/shared/styles/tokens';

type Props = {
  scope: string;
  mode: string;
  keyboardVisible: boolean;
  busy: boolean;
  canPost: boolean;
  paddingTop: number;
  onCancel: () => void;
  onPost: () => void;
};

export function PostComposerHeader({
  scope,
  mode,
  keyboardVisible,
  busy,
  canPost,
  paddingTop,
  onCancel,
  onPost,
}: Props) {
  return (
    <VisualLayoutProbe
      scope={scope}
      surface="composer"
      component="PostComposerHeader"
      itemKey="header"
      itemType="header"
      style={[styles.headerRow, { paddingTop }]}
      extra={{ mode, keyboardVisible, busy }}>
      <Button variant="ghost" size="md" onPress={onCancel}>
        <Button.Label>Cancel</Button.Label>
      </Button>
      <Button
        variant="primary"
        size="sm"
        onPress={onPost}
        isDisabled={!canPost}
        style={!canPost ? styles.disabledPostButton : undefined}>
        <Button.Label>{busy ? 'Posting…' : 'Post'}</Button.Label>
      </Button>
    </VisualLayoutProbe>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.sm,
    paddingRight: spacing.lg,
    paddingBottom: spacing.md,
  },
  disabledPostButton: { opacity: alpha.disabled },
});
