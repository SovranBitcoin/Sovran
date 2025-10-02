import { ButtonHandler } from 'components/ui/ButtonHandler';
import React, { useState } from 'react';
import { TextInput } from 'react-native';
import { RouteScreenProps, useSheetRef } from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { View, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';

// eslint-disable-next-line no-empty-pattern
const MessageInput = ({}: RouteScreenProps<'transaction-message', 'message-input'>) => {
  const [message, setMessage] = useState('');
  const sheetRef = useSheetRef('transaction-message');
  const theme = useSelector(memoizedGetTheme);

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
      action: 'skip',
      message: '',
    });
  };

  return (
    <View
      className="overflow-hidden rounded-2xl p-4"
      style={{ backgroundColor: greys(theme)[800] }}>
      <VStack gap={6}>
        <Text heavy size={20}>
          Add a note
        </Text>
        <Text regular size={16} color={greys(theme)[100]}>
          Add an optional message to your transaction
        </Text>

        <TextInput
          testID="message-input"
          className="min-h-[120px] rounded-lg border border-gray-950 bg-gray-900 p-3 text-base"
          style={{
            color: greys(theme)[100],
            textAlignVertical: 'top',
          }}
          multiline
          numberOfLines={4}
          placeholder="Enter your message here (optional)"
          placeholderTextColor={greys(theme)[500]}
          value={message}
          onChangeText={setMessage}
          textAlignVertical="top"
        />
        <ButtonHandler
          style={{ backgroundColor: greys(theme)[800] }}
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
      </VStack>
    </View>
  );
};

export default MessageInput;
