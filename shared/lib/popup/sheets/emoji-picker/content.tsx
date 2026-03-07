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
import * as Clipboard from 'expo-clipboard';
import chunk from 'lodash/chunk';
import { copyPopup } from '@/shared/lib/popup';
import { encode } from '@/shared/lib/third-party/emoji';
import { Card } from '@/shared/ui/composed/Card';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { View } from '@/shared/ui/primitives/View/View';
import { SheetContent } from '../SheetContent';
import type { ActionSheetPayloads } from '../../actionSheetTypes';
import type { CustomSheetSharedProps } from '../types';
import { Description } from 'heroui-native';

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

const STICKY_FOOTER_SAFE_PADDING_BOTTOM = 16;

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
    copyPopup('ecashToken', { onOpen: close });
  };

  return (
    <SheetContent
      title="Emoji picker"
      scrollProps={{
        contentContainerStyle: { paddingBottom: canPop ? STICKY_FOOTER_SAFE_PADDING_BOTTOM : 12 },
        enableFooterMarginAdjustment: canPop,
      }}>
      <View>
        <Description>Pick an emoji to encode and copy your token.</Description>
        <Card message={"These encoded emoji's don't work on every platform."} variant="info" />
        <Spacer size={10} />
        {emojiRows.map((row, rowIndex) => (
          <HStack key={rowIndex} justify="space-between" className="mb-3">
            {row.map((emoji, colIndex) => (
              <TouchableOpacity
                testID={emoji.id}
                key={colIndex}
                className={`bg-surface-tertiary flex-1 rounded-lg p-3 ${colIndex > 0 ? 'ml-2' : ''}`}
                onPress={() => handleEmojiSelect(emoji.emoji)}>
                <View className="items-center justify-center">
                  <Text className="text-2xl">{emoji.emoji}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </HStack>
        ))}
      </View>
    </SheetContent>
  );
}
