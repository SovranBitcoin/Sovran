/**
 * @fileoverview EmojiPickerContent - Bitcoin emoji selection
 *
 * @description
 * Grid of 11 Bitcoin-themed emojis. On selection: encodes token, copies to
 * clipboard, shows success popup, closes sheet.
 *
 * **Flow:** Display grid → user taps emoji → encode → clipboard → popup → close
 */

import React from 'react';
import { TouchableOpacity } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Text } from '@/shared/ui/primitives/Text';
import chunk from 'lodash/chunk';
import { encode } from '@/shared/lib/third-party/emoji';
import * as Clipboard from 'expo-clipboard';
import { Card } from '@/shared/ui/composed/Card';
import { copyPopup } from '@/shared/lib/popup';
import type { ActionSheetPayloads } from '@/shared/lib/popup';

interface EmojiPickerContentProps {
  payload: ActionSheetPayloads['emoji-picker'];
  close: () => void;
}

const EMOJIS = [
  { id: 'laugh', emoji: '😂' },
  { id: 'nut', emoji: '🥜' },
  { id: 'lightning', emoji: '⚡' },
  { id: 'heart', emoji: '🧡' },
  { id: 'trophy', emoji: '🏆' },
  { id: 'volcano', emoji: '🌋' },
  { id: 'rocket', emoji: '🚀' },
  { id: 'money', emoji: '💰' },
  { id: 'key', emoji: '🔑' },
  { id: 'badger', emoji: '🦡' },
  { id: 'ape', emoji: '🦍' },
];

export function EmojiPickerContent({ payload, close }: EmojiPickerContentProps) {
  const emojiRows = chunk(EMOJIS, 4);

  const handleEmojiSelect = async (emoji: string) => {
    const encodedEmoji = encode(emoji, payload.token);
    await Clipboard.setStringAsync(encodedEmoji);
    copyPopup('ecashToken', { onClose: () => close() });
  };

  return (
    <View className="bg-background mx-4 mb-0 overflow-hidden rounded-2xl">
      <VStack className="p-6">
        <Text weight="bold" className="text-foreground text-lg font-semibold">
          Encode as Emoji
        </Text>
        <Spacer size={12} />
        <Card message={"These encoded emoji's don't work on every platform."} variant="info" />
        <Spacer size={12} />
        <BottomSheetScrollView>
          {emojiRows.map((row, rowIndex) => (
            <HStack key={rowIndex} justify="space-between" className="mb-3">
              {row.map((emoji, colIndex) => (
                <TouchableOpacity
                  testID={emoji.id}
                  key={colIndex}
                  className={`bg-surface-secondary flex-1 rounded-lg p-3 ${colIndex > 0 ? 'ml-2' : ''}`}
                  onPress={() => handleEmojiSelect(emoji.emoji)}>
                  <VStack align="center" justify="center" flex={1}>
                    <Text className="text-2xl">{emoji.emoji}</Text>
                  </VStack>
                </TouchableOpacity>
              ))}
            </HStack>
          ))}
        </BottomSheetScrollView>
      </VStack>
    </View>
  );
}
