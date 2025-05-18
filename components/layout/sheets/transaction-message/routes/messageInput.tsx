import { ButtonHandler } from 'components/common/ButtonHandler';
import React, { useState } from 'react';
import { TextInput, StyleSheet } from 'react-native';
import { RouteScreenProps, useSheetRef, ScrollView } from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { View, Text } from 'components/common/Themed';
import { ClickOutsideProvider, useClickOutside } from 'react-native-click-outside';
import { Keyboard } from 'react-native';

const MessageInput = ({
  router,
  payload,
}: RouteScreenProps<'transaction-message', 'message-input'>) => {
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
        backgroundColor: greys(theme)[1800],
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
