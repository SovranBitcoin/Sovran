import { ButtonHandler } from 'components/ui/ButtonHandler';
import React, { useState } from 'react';
import { TextInput } from 'react-native';
import { RouteScreenProps, useSheetRef } from 'react-native-actions-sheet';
import { useTheme } from 'providers/ThemeProvider';
import { View, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';

// eslint-disable-next-line no-empty-pattern
const MessageInput = ({}: RouteScreenProps<'transaction-message', 'message-input'>) => {
  const [message, setMessage] = useState('');
  const sheetRef = useSheetRef('transaction-message');
  const { getPrimaryColor } = useTheme();

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
    <View className="bg-primary-800 overflow-hidden rounded-2xl p-4">
      <VStack gap={6}>
        <Text heavy size={20}>
          Add a note
        </Text>
        <Text regular size={16} className="text-primary-100">
          Add an optional message to your transaction
        </Text>

        <TextInput
          testID="message-input"
          className="border-primary-950 bg-primary-900 text-primary-100 min-h-[120px] rounded-lg border p-3 text-base"
          style={{
            textAlignVertical: 'top',
          }}
          multiline
          numberOfLines={4}
          placeholder="Enter your message here (optional)"
          placeholderTextColor={getPrimaryColor('500')}
          value={message}
          onChangeText={setMessage}
          textAlignVertical="top"
        />
        <ButtonHandler
          className="bg-primary-800"
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
