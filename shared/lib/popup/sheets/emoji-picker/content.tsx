/**
 * @fileoverview EmojiPickerContent - Bitcoin emoji selection
 *
 * @description
 * Grid of 11 Bitcoin-themed emojis. On selection: encodes token, copies to
 * clipboard, shows success popup, closes sheet.
 *
 * **Flow:** Display grid → user taps emoji → encode → clipboard → popup → close
 */

import React, { useEffect } from 'react';
import { TouchableOpacity } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { BottomSheet } from 'heroui-native';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Text } from '@/shared/ui/primitives/Text';
import chunk from 'lodash/chunk';
import { encode } from '@/shared/lib/third-party/emoji';
import * as Clipboard from 'expo-clipboard';
import { Card } from '@/shared/ui/composed/Card';
import { copyPopup } from '@/shared/lib/popup';
import type { ActionSheetPayloads } from '../../actionSheetTypes';
import type { CustomSheetSharedProps } from '../types';

interface EmojiPickerContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['emoji-picker'];
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

export function EmojiPickerContent({
  payload,
  close,
  popCustomPage,
  canPop,
  setFooterConfig,
}: EmojiPickerContentProps) {
  const emojiRows = chunk(EMOJIS, 4);

  useEffect(() => {
    setFooterConfig(
      canPop
        ? {
            buttons: [
              {
                label: 'Back',
                variant: 'tertiary',
                onPress: popCustomPage,
              },
            ],
          }
        : null
    );
    return () => setFooterConfig(null);
  }, [setFooterConfig, canPop, popCustomPage]);

  const handleEmojiSelect = async (emoji: string) => {
    const encodedEmoji = encode(emoji, payload.token);
    await Clipboard.setStringAsync(encodedEmoji);
    copyPopup('ecashToken', { onClose: () => close() });
  };

  return (
    <View>
      <View>
        <View className="flex-row items-center justify-between">
          <BottomSheet.Title className="text-lg font-bold">Emoji picker</BottomSheet.Title>
          <BottomSheet.Close />
        </View>
        <Text className="text-foreground/50 pt-1 text-sm">
          Pick an emoji to encode and copy your token.
        </Text>
      </View>
      <VStack className="pb-2 pt-4">
        <Card message={"These encoded emoji's don't work on every platform."} variant="info" />
        <Spacer size={10} />
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
