/**
 * @fileoverview MessageInput - Transaction message input form
 *
 * @module components/blocks/sheets/transaction-message/routes/message-input
 *
 * @description
 * Text input form for adding optional messages to transactions. Users can
 * type a message and confirm or skip entirely. Returns action and message text.
 *
 * **Navigation:**
 * - From: Initial route (sheet opens here)
 * - To: Closes with result after confirm/skip
 * - Close: `sheetRef.current?.hide({action, message})`
 *
 * **Data:**
 * - Payload: None (no payload needed)
 * - Params: None (single route)
 *
 * **Flow:** Display form → user types → confirm/skip → close with result
 *
 * @see {@link ./index}
 */

import { ButtonHandler } from 'components/ui/ButtonHandler';
import React, { useState } from 'react';
import { TextInput } from 'react-native';
import { RouteScreenProps, useSheetRef } from 'react-native-actions-sheet';
import { useTheme } from 'providers/ThemeProvider';
import { VStack } from 'components/ui/View/VStack';
import { View } from 'components/ui/View/View';
import { Text } from 'components/ui/Text';

/**
 * MessageInput Component
 *
 * @component
 * @param {RouteScreenProps<'transaction-message', 'message-input'>} props
 * @returns {JSX.Element}
 */
const MessageInput = (_props: RouteScreenProps<'transaction-message', 'message-input'>) => {
  const [message, setMessage] = useState('');
  const sheetRef = useSheetRef('transaction-message');
  const { getPrimaryColor } = useTheme();

  /**
   * Handles message confirmation
   *
   * @async
   * @description Closes sheet with confirm action and trimmed message
   *
   * **Process:** trim message → sheetRef.hide()
   * **Effects:** Sheet close with result
   */
  const handleConfirm = async () => {
    sheetRef.current?.hide({
      action: 'confirm',
      message: message.trim(),
    });
  };

  /**
   * Handles message skip
   *
   * @async
   * @description Closes sheet with skip action and empty message
   *
   * **Process:** sheetRef.hide()
   * **Effects:** Sheet close with result
   */
  const handleSkip = async () => {
    sheetRef.current?.hide({
      action: 'skip',
      message: '',
    });
  };

  return (
    <View className="overflow-hidden rounded-2xl bg-primary-800 p-4">
      <VStack gap={6}>
        <Text heavy size={20}>
          Add a note
        </Text>
        <Text regular size={16} className="text-primary-100">
          Add an optional message to your transaction
        </Text>

        <TextInput
          testID="message-input"
          className="min-h-[120px] rounded-lg border border-primary-950 bg-primary-900 p-3 text-base text-primary-100"
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
          gradientColor={getPrimaryColor('800')}
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
