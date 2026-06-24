/**
 * @fileoverview Composer bottom toolbar: add-media + poll toggles and char meter.
 *
 * Extracted from `PostComposer` as a pure presentational seam. The
 * `VisualLayoutProbe` keeps its original scope/component/itemKey strings so the
 * content-shift log taxonomy (`composer.*`) is unchanged. Enablement is computed
 * by the parent and passed in as booleans so this stays config-agnostic.
 */
import { StyleSheet, View } from 'react-native';

import Icon from 'assets/icons';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';

type Props = {
  scope: string;
  mode: string;
  keyboardVisible: boolean;
  mediaCount: number;
  canPost: boolean;
  paddingBottom: number;
  mutedColor: string;
  accentColor: string;
  dangerColor: string;
  remaining: number;
  overBudget: boolean;
  addMediaDisabled: boolean;
  pollDisabled: boolean;
  pollActive: boolean;
  onAddMedia: () => void;
  onTogglePoll: () => void;
};

export function PostComposerToolbar({
  scope,
  mode,
  keyboardVisible,
  mediaCount,
  canPost,
  paddingBottom,
  mutedColor,
  accentColor,
  dangerColor,
  remaining,
  overBudget,
  addMediaDisabled,
  pollDisabled,
  pollActive,
  onAddMedia,
  onTogglePoll,
}: Props) {
  return (
    <VisualLayoutProbe
      scope={scope}
      surface="composer"
      component="PostComposerToolbar"
      itemKey="toolbar"
      itemType="toolbar"
      className="flex-row items-center gap-5 px-4 py-2"
      style={{
        paddingBottom,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: mutedColor,
      }}
      extra={{ mode, keyboardVisible, mediaCount, hasPoll: pollActive, canPost }}>
      <Pressable
        onPress={onAddMedia}
        disabled={addMediaDisabled}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Add photo or video">
        <Icon name="mdi:image-plus" size={24} color={addMediaDisabled ? mutedColor : accentColor} />
      </Pressable>
      <Pressable
        onPress={onTogglePoll}
        disabled={pollDisabled}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={pollActive ? 'Remove poll' : 'Add poll'}>
        <Icon
          name="mdi:poll"
          size={24}
          color={pollDisabled ? mutedColor : pollActive ? accentColor : mutedColor}
        />
      </Pressable>
      <View className="flex-1" />
      <Text size={13} style={{ color: overBudget ? dangerColor : mutedColor }}>
        {remaining}
      </Text>
    </VisualLayoutProbe>
  );
}
