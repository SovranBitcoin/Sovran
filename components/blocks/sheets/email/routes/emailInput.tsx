import { ButtonHandler } from 'components/ui/ButtonHandler';
import React, { useState } from 'react';
import { TextInput, StyleSheet } from 'react-native';
import { RouteScreenProps, useSheetRef } from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, Theme } from 'helper/colors';
import { Spacer, View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { Card } from 'components/ui/Card';

// eslint-disable-next-line no-empty-pattern
const MessageInput = ({}: RouteScreenProps<'email-sheet', 'email'>) => {
  const [message, setMessage] = useState('');
  const sheetRef = useSheetRef('email-sheet');
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  // Handler for confirming with message
  const handleConfirm = async () => {
    sheetRef.current?.hide({
      action: 'confirm',
      message: message.trim(),
    });
  };

  // Handler for skipping the message
  const handleSkip = async () => {
    sheetRef.current?.hide({
      action: 'cancel',
      message: '',
    });
  };

  return (
    <View
      style={{
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: greys(theme)[800],
        padding: 16,
      }}>
      <Spacer size={12} />
      <Text style={styles.title}>Input Email</Text>
      <Card
        message="Purchased giftcards will be sent to your email. It's very IMPORTANT you enter a valid email address you control otherwise your giftcards will be LOST."
        variant="warning"></Card>
      <Spacer size={12} />

      <TextInput
        style={styles.textInput}
        multiline
        numberOfLines={4}
        placeholder="satoshi@gmx.com"
        placeholderTextColor={greys(theme)[500]}
        value={message}
        onChangeText={setMessage}
        textAlignVertical="top"
      />

      <ButtonHandler
        colors={[greys(theme)[800], greys(theme)[800]]}
        context="sheet"
        buttons={[
          {
            text: 'Cancel',
            variant: 'secondary',
            onPress: handleSkip,
          },
          {
            text: 'Confirm',
            variant: 'primary',
            onPress: handleConfirm,
          },
        ]}
      />
    </View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    title: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 8,
    },
    textInput: {
      borderWidth: 0.5,
      borderColor: greys(theme)[950],
      backgroundColor: greys(theme)[900],
      color: greys(theme)[100],
      borderRadius: 8,
      padding: 12,
      fontSize: 16,
      minHeight: 120,
      textAlignVertical: 'top',
    },
  });

export default MessageInput;
