import { ButtonHandler } from 'components/common/ButtonHandler';
import React, { useState } from 'react';
import { TextInput, StyleSheet } from 'react-native';
import { RouteScreenProps, useSheetRef } from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { Card } from 'components/common/Card';

const MessageInput = ({ router }: RouteScreenProps<'email-sheet', 'email'>) => {
  const [message, setMessage] = useState('');
  const sheetRef = useSheetRef('transaction-message');
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  // Handler for confirming with message
  const handleConfirm = () => {
    sheetRef.current?.hide({
      action: 'confirm',
      message: message.trim(),
    });
  };

  // Handler for skipping the message
  const handleSkip = () => {
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
        backgroundColor: greys(theme)[1800],
        padding: 16,
      }}>
      <Text style={styles.title}>Input Email</Text>
      <Card
        message="Purchased giftcards will be sent to your email. It's very IMPORTANT you enter a valid email address you control otherwise your giftcards will be LOST."
        variant="warning"></Card>

      <TextInput
        style={styles.textInput}
        multiline
        numberOfLines={4}
        placeholder="satoshi@gmx.com"
        placeholderTextColor={greys(theme)[1000]}
        value={message}
        onChangeText={setMessage}
        textAlignVertical="top"
      />

      <ButtonHandler
        colors={[greys(theme)[1800], greys(theme)[1800]]}
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

const createStyles = (theme: string) =>
  StyleSheet.create({
    container: {
      padding: 16,
      flex: 1,
    },
    title: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 16,
      color: greys(theme)[200],
      marginBottom: 24,
    },
    inputContainer: {
      flex: 1,
      marginBottom: 24,
      height: 300,
    },
    textInput: {
      borderWidth: 0.5,
      borderColor: greys(theme)[2300],
      backgroundColor: greys(theme)[2000],
      color: greys(theme)[200],
      borderRadius: 8,
      padding: 12,
      fontSize: 16,
      minHeight: 120,
      textAlignVertical: 'top',
    },
    buttonContainer: {
      marginTop: 16,
    },
  });

export default MessageInput;
