/**
 * @fileoverview Send flow paymentRequest route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * Handles NUT-18 payment request confirmation before sending.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { PaymentRequestScreen } from 'components/screens/PaymentRequestScreen';

function ModalScreen() {
  const { paymentRequest } = useLocalSearchParams<{
    paymentRequest?: string;
  }>();

  return (
    <>
      <Stack.Screen options={{ title: 'Payment Request' }} />
      <PaymentRequestScreen
        paymentRequest={paymentRequest}
        onCancel={() => {
          router.dismissAll();
          router.navigate('/(drawer)/(tabs)');
        }}
        onPaymentCompleted={(sendHistoryEntry) => {
          router.replace({
            pathname: '/(send-flow)/sendToken',
            params: {
              sendHistoryEntry: JSON.stringify(sendHistoryEntry),
            },
          });
        }}
      />
    </>
  );
}

export default withSheetProvider(ModalScreen);



