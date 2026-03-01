/**
 * @fileoverview EmojiGrid - Bitcoin emoji selection
 *
 * @module components/blocks/sheets/emoji-picker/routes/emoji-grid
 *
 * @description
 * Grid of 11 Bitcoin-themed emojis. On selection: encodes token, copies to
 * clipboard, shows success popup, closes sheet via router.goBack().
 *
 * **Navigation:**
 * - From: Initial route (sheet opens here)
 * - To: Closes after selection (only route)
 *
 * **Data:**
 * - Payload: `{token: string}` - The ecash token to encode
 *
 * **Flow:** Display grid → user taps emoji → encode → clipboard → popup → close
 *
 * @see {@link ./index}
 */

import React from 'react';
import { TouchableOpacity } from 'react-native';
import { RouteScreenProps, ScrollView, useSheetPayload } from 'react-native-actions-sheet';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { Text } from 'components/ui/Text';
import chunk from 'lodash/chunk';
import { encode } from 'helper/third-party/emoji';
import * as Clipboard from 'expo-clipboard';
import { Card } from 'components/ui/Card';
import { copyPopup } from '@/helper/popup';

/**
 * EmojiGrid Component
 *
 * @component
 * @param {RouteScreenProps<'emoji-picker', 'emoji-grid'>} props
 * @returns {JSX.Element}
 */
const EmojiGrid = ({ router }: RouteScreenProps<'emoji-picker', 'emoji-grid'>) => {
  const payload = useSheetPayload('emoji-picker');

  /**
   * Emojis for token encoding
   *
   * @constant
   * @type {Array<{id: string, emoji: string}>}
   */
  const emojis = [
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

  const emojiRows = chunk(emojis, 4);

  /**
   * Handles emoji selection
   *
   * @async
   * @description Encodes token, copies to clipboard, shows popup, closes sheet
   *
   * **Process:** encode → clipboard → popup → router.goBack()
   * **Effects:** Clipboard write, shows notification, closes sheet
   *
   * @param {string} emoji - Selected emoji character
   */
  const handleEmojiSelect = async (emoji: string) => {
    const encodedEmoji = encode(emoji, payload.token);
    await Clipboard.setStringAsync(encodedEmoji);
    copyPopup('ecashToken', { onClose: () => router?.goBack() });
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
        <ScrollView>
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
        </ScrollView>
      </VStack>
    </View>
  );
};

export default EmojiGrid;
