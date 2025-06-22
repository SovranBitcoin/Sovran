import { greys } from 'helper/colors';
import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { RouteScreenProps, ScrollView, useSheetPayload } from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { View, Text } from 'components/common/Themed';
import chunk from 'lodash/chunk';
import { encode } from 'helper/third-party/emoji';
import { showSuccess } from 'helper/popup/popups';
import * as Clipboard from 'expo-clipboard';
import { Card } from 'components/common/Card';

const EmojiGrid = ({ router }: RouteScreenProps<'emoji-picker', 'emoji-grid'>) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const payload = useSheetPayload('emoji-picker');

  const emojis = [
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
      <Card message={"These encoded emoji's don't work on every platform."} variant="info" />
      <ScrollView contentContainerStyle={styles.gridContainer}>
        {emojiRows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((emoji, colIndex) => (
              <TouchableOpacity
                testID={emoji.id}
                key={colIndex}
                style={[
                  styles.emojiButton,
                  colIndex > 0 && { marginLeft: 8 }, // Only add marginLeft if not the first in the row
                ]}
                onPress={() => handleEmojiSelect(emoji.emoji)}>
                <Text style={styles.emoji}>{emoji.emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const createStyles = (theme: string) =>
  StyleSheet.create({
    container: {
      marginHorizontal: 16,
      marginBottom: 0,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: greys(theme)[2300],
    },
    title: {
      color: greys(theme)[0],
      fontSize: 18,
      fontWeight: '600',
    },
    gridContainer: {
      flexDirection: 'column',
      justifyContent: 'flex-start',
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    emojiButton: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
      padding: 12,
    },
    emoji: {
      fontSize: 24,
    },
  });

export default EmojiGrid;
