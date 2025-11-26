/**
 * @fileoverview Standalone receive route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 */

import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { ReceiveScreen, getFormattedReceiveTitle } from 'components/screens/ReceiveScreen';
import { useTheme } from 'providers/ThemeProvider';
import Icon from 'assets/icons';

const EcashLightningReceiver = () => {
  const { unit } = useLocalSearchParams<{ unit: string }>();
  const { getPrimaryColor } = useTheme();
  const formattedTitle = getFormattedReceiveTitle(unit || 'sat');

  const CloseButton = () => (
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
      <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
    </TouchableOpacity>
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: formattedTitle,
          headerTitleStyle: { color: getPrimaryColor('0') },
          headerTintColor: getPrimaryColor('0'),
          headerLeft: () => <CloseButton />,
        }}
      />
      <ReceiveScreen
        unit={unit || 'sat'}
        onReceiveToken={(receiveHistoryEntry) => {
          router.push({
            pathname: '/receiveToken',
            params: {
              receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
            },
          });
        }}
        onCamera={(unit) => {
          router.push({
            pathname: '/camera',
            params: { unit },
          });
        }}
        onFixedAmount={(unit) => {
          router.push({
            pathname: '/currency',
            params: {
              to: 'mintQuote',
              unit,
            },
          });
        }}
      />
    </>
  );
};

export default withSheetProvider(EcashLightningReceiver);
