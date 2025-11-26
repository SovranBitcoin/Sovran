/**
 * @fileoverview Standalone sendToken route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 */

import React from 'react';
import { TouchableOpacity } from 'react-native';
import { View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { withSheetProvider } from 'hocs/withSheetProvider';
import type { SendHistoryEntry } from 'coco-cashu-core';
import { useTheme } from 'providers/ThemeProvider';
import { SendTokenScreen } from 'components/screens/SendTokenScreen';
import Icon from 'assets/icons';

function ModalScreen() {
  const params = useLocalSearchParams<{
    sendHistoryEntry: string;
  }>();
  const { sendHistoryEntry: sendHistoryEntryString } = params;
  const { getPrimaryColor } = useTheme();

  const CloseButton = () => (
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
      <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
    </TouchableOpacity>
  );

  const headerOptions = {
    title: 'Send Ecash',
    headerTitleStyle: { color: getPrimaryColor('0') },
    headerTintColor: getPrimaryColor('0'),
    headerLeft: () => <CloseButton />,
  };

  if (!sendHistoryEntryString) {
    return (
      <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
        <Stack.Screen options={headerOptions} />
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
        <Stack.Screen options={headerOptions} />
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
      <Stack.Screen options={headerOptions} />
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
