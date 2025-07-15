import { ButtonHandler } from 'components/common/ButtonHandler';
import React, { useState } from 'react';
import { TextInput, StyleSheet } from 'react-native';
import { RouteScreenProps, useSheetRef } from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, Theme } from 'helper/colors';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';

// eslint-disable-next-line no-empty-pattern
const MessageInput = ({}: RouteScreenProps<'transaction-message', 'message-input'>) => {
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
      action: 'skip',
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
      <Text style={styles.title}>Add a note</Text>
      <Text style={styles.subtitle}>Add an optional message to your transaction</Text>

      <TextInput
        testID="message-input"
        style={styles.textInput}
        multiline
        numberOfLines={4}
        placeholder="Enter your message here (optional)"
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
            text: 'Skip',
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
      color: greys(theme)[100],
      marginBottom: 24,
    },
    inputContainer: {
      flex: 1,
      marginBottom: 24,
      height: 300,
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
    buttonContainer: {
      marginTop: 16,
    },
  });

export default MessageInput;
