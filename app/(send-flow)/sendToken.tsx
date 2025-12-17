/**
 * @fileoverview Send flow sendToken route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * Supports two modes:
 * 1. Normal mode: Token already created (sendHistoryEntry param)
 * 2. Payment request mode: No token yet, shows confirmation UI (paymentRequest + amount + selectedMintUrl params)
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { SendTokenScreen } from 'components/screens/SendTokenScreen';

function ModalScreen() {
  const params = useLocalSearchParams<{
    // Normal mode: token already created
    sendHistoryEntry?: string;
    // Payment request mode: no token yet, confirmation UI
    paymentRequest?: string; // Encoded payment request (creqA...)
    amount?: string; // Amount in sats
    selectedMintUrl?: string; // Mint URL to use
    // Indicates Nostr DM was already sent (from CurrencyScreen payment request flow)
    nostrSent?: string;
  }>();

  // Build payment request prop if in payment request mode
  const paymentRequestProp =
    params.paymentRequest && params.amount && params.selectedMintUrl
      ? {
          encodedRequest: params.paymentRequest,
          amount: parseInt(params.amount, 10),
          mintUrl: params.selectedMintUrl,
        }
      : undefined;

  return (
    <>
      <Stack.Screen
        options={{ title: paymentRequestProp ? 'Payment Request' : 'Send Ecash' }}
      />
      <SendTokenScreen
        sendHistoryEntry={params.sendHistoryEntry}
        paymentRequest={paymentRequestProp}
        initialNostrSent={params.nostrSent === 'true'}
        onNavigateBack={() => router.back()}
        onNavigateToMessages={(pubkey) =>
          router.navigate({
            pathname: '/userMessages',
            params: { pubkey },
          })
        }
      />
    </>
  );
}

export default withSheetProvider(ModalScreen);
