/**
 * @fileoverview Horizontal chip strip for currently-selected participants.
 *
 * Rendered above the picker list. Each chip shows the avatar + truncated
 * nickname and a small ✕ to remove that participant from the selection.
 * Tap the ✕ to remove; the chip has no other action.
 *
 * Used only when `selected.length > 0` — caller should hide the row
 * otherwise to avoid a blank band of space.
 */

import React from 'react';
import { ScrollView, StyleSheet, Pressable } from 'react-native';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { PickerCandidate } from '../hooks/useSplitBillParticipantPicker';

interface Props {
  selected: PickerCandidate[];
  onRemove: (id: string) => void;
}

export function SelectedChipsRow({ selected, onRemove }: Props) {
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);

  if (selected.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}>
      {selected.map((candidate) => {
        const nickname =
          candidate.nickname ?? candidate.pubkey?.slice(0, 8) ?? candidate.peerID?.slice(0, 8) ?? '?';
        return (
          <View
            key={candidate.id}
            style={[styles.chip, { backgroundColor: surfaceSecondary }]}>
            <HStack align="center" spacing={6}>
              {candidate.source === 'ble' ? (
                <View
                  style={[
                    styles.bleAvatar,
                    { backgroundColor: opacity('#0A84FF', 0.18) },
                  ]}>
                  <Icon name="mdi:bluetooth" size={14} color="#0A84FF" />
                </View>
              ) : (
                <Avatar
                  state={candidate.avatarUrl ? 'image' : 'fallback'}
                  picture={candidate.avatarUrl}
                  name={candidate.nickname}
                  seed={candidate.pubkey}
                  size={24 as any}
                />
              )}
              <Text size={13} bold numberOfLines={1} style={styles.chipLabel} color={foreground}>
                {nickname}
              </Text>
              <Pressable onPress={() => onRemove(candidate.id)} hitSlop={8}>
                <Icon name="mdi:close" size={16} color={opacity(foreground, 0.6)} />
              </Pressable>
            </HStack>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  chip: {
    paddingLeft: 4,
    paddingRight: 8,
    paddingVertical: 4,
    borderRadius: 20,
  },
  chipLabel: {
    maxWidth: 120,
  },
  bleAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
