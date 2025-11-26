/**
 * @fileoverview Transactions flow sendToken route wrapper
 *
 * Part of the (transactions-flow) modal group - displays with back button.
 */

import React from 'react';
import { View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { withSheetProvider } from 'hocs/withSheetProvider';
import type { SendHistoryEntry } from 'coco-cashu-core';
import { useTheme } from 'providers/ThemeProvider';
import { SendTokenScreen } from 'components/screens/SendTokenScreen';

function ModalScreen() {
  const params = useLocalSearchParams<{
    sendHistoryEntry: string;
  }>();
  const { sendHistoryEntry: sendHistoryEntryString } = params;
  const { getPrimaryColor } = useTheme();

  if (!sendHistoryEntryString) {
    return (
      <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
        <Stack.Screen options={{ title: 'Send Ecash' }} />
        <View style={{ flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center' }}>
          <Text>Missing transaction data. Please try again.</Text>
          <ButtonHandler
            buttons={[
              {
                text: 'Go Back',
                icon: 'ri:arrow-left-line',
                variant: 'primary',
                onPress: async () => router.back(),
              },
            ]}
          />
        </View>
      </View>
    );
  }

  let sendHistoryEntry: SendHistoryEntry;
  try {
    sendHistoryEntry = JSON.parse(sendHistoryEntryString) as SendHistoryEntry;
  } catch {
    return (
      <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
        <Stack.Screen options={{ title: 'Send Ecash' }} />
        <View style={{ flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center' }}>
          <Text>Invalid transaction data. Please try again.</Text>
          <ButtonHandler
            buttons={[
              {
                text: 'Go Back',
                icon: 'ri:arrow-left-line',
                variant: 'primary',
                onPress: async () => router.back(),
              },
            ]}
          />
        </View>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Send Ecash' }} />
      <SendTokenScreen
        sendHistoryEntry={sendHistoryEntry}
        onNavigateBack={() => router.back()}
        onNavigateToMessages={(pubkey) =>
          router.push({
            pathname: '/userMessages',
            params: { pubkey },
          })
        }
      />
    </>
  );
}

export default withSheetProvider(ModalScreen);

