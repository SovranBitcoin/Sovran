import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { RouteScreenProps, ScrollView, useSheetPayload } from 'react-native-actions-sheet';
import { useTheme } from 'providers/ThemeProvider';
import { Spacer, View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import chunk from 'lodash/chunk';
import { encode } from 'helper/third-party/emoji';
import { showSuccess } from 'helper/popup/popups';
import * as Clipboard from 'expo-clipboard';
import { Card } from 'components/ui/Card';

const EmojiGrid = ({ router }: RouteScreenProps<'emoji-picker', 'emoji-grid'>) => {
  const { getPrimaryColor } = useTheme();
  const styles = createStyles(getPrimaryColor);

  const payload = useSheetPayload('emoji-picker');

  const emojis = [
    { id: 'laugh', emoji: '😂' },
    { id: 'nut', emoji: '🥜' }, // peanut (inside joke in some bitcoin circles)
    { id: 'lightning', emoji: '⚡' }, // lightning (for Lightning Network)
    { id: 'heart', emoji: '🧡' }, // orange heart (bitcoin community love)
    { id: 'trophy', emoji: '🏆' }, // trophy (winning)
    { id: 'volcano', emoji: '🌋' }, // volcano (El Salvador volcano bonds)
    { id: 'rocket', emoji: '🚀' }, // rocket (to the moon)
    { id: 'money', emoji: '💰' }, // money bag
    { id: 'key', emoji: '🔑' }, // key (private keys)
    { id: 'badger', emoji: '🦡' }, // badger (bitcoin badger/mascot)
    { id: 'ape', emoji: '🦍' }, // ape ("apeing in")
  ];

  const emojiRows = chunk(emojis, 4); // 3 columns per row

  const handleEmojiSelect = async (emoji: string) => {
    // Return the selected emoji when closing the sheet
    const encodedEmoji = encode(emoji, payload.token);
    Clipboard.setStringAsync(encodedEmoji);
    showSuccess('ecash_token_copied', {}, {}, () => {
      router?.goBack();
    });
  };

  return (
    <View style={styles.container}>
      <Text weight="bold" style={[styles.title, { marginTop: 24 }]}>
        Encode as Emoji
      </Text>
      <Spacer size={12} />
      <Card message={"These encoded emoji's don't work on every platform."} variant="info" />
      <Spacer size={12} />
      <ScrollView>
        {emojiRows.map((row, rowIndex) => (
          <HStack key={rowIndex} justify="space-between" style={styles.row}>
            {row.map((emoji, colIndex) => (
              <TouchableOpacity
                testID={emoji.id}
                key={colIndex}
                style={[
                  styles.emojiButton,
                  colIndex > 0 && { marginLeft: 8 }, // Only add marginLeft if not the first in the row
                ]}
                onPress={() => handleEmojiSelect(emoji.emoji)}>
                <VStack align="center" justify="center" flex={1}>
                  <Text style={styles.emoji}>{emoji.emoji}</Text>
                </VStack>
              </TouchableOpacity>
            ))}
          </HStack>
        ))}
      </ScrollView>
    </View>
  );
};

const createStyles = (getPrimaryColor: (shade: string) => string) =>
  StyleSheet.create({
    container: {
      marginHorizontal: 16,
      marginBottom: 0,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: getPrimaryColor('950'),
    },
    title: {
      color: getPrimaryColor('0'),
      fontSize: 18,
      fontWeight: '600',
    },
    row: {
      marginBottom: 12,
    },
    emojiButton: {
      flex: 1,
      backgroundColor: getPrimaryColor('800'),
      borderRadius: 8,
      padding: 12,
    },
    emoji: {
      fontSize: 24,
    },
  });

export default EmojiGrid;
