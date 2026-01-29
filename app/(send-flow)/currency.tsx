/**
 * @fileoverview Send flow currency route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * Uses useProcessPaymentString hook for payment processing.
 */

import React from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { CurrencyScreen } from 'components/screens/CurrencyScreen';
import { useProcessPaymentString } from '@/hooks/coco/useProcessPaymentString';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';

function ModalScreen() {
  const params = useLocalSearchParams<{
    amount?: string;
    unit: string;
    to: string;
    paymentRequest?: string;
    profile?: string;
    recipientPubkey?: string;
    lud16?: string;
    allowedUnits?: string;
    mints?: string;
    lnUrlOrAddress?: string;
    routstrTopUp?: string;
    selectedMintUrl?: string; // Pre-selected mint URL (for payment requests with single valid mint)
    allowedMints?: string; // JSON array of allowed mint URLs (for payment requests)
  }>();

  console.log('[LIGHTNING-FLOW] currency.tsx received params', {
    to: params.to,
    lnUrlOrAddress: params.lnUrlOrAddress,
    lud16: params.lud16,
    amount: params.amount,
  });

  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

  const { processPaymentString } = useProcessPaymentString({
    unit: params?.unit?.toLowerCase() || 'sat',
    selectedMint,
    isFocused: true,
  });

  return (
    <>
      <Stack.Screen options={{ title: 'Select Amount' }} />
      <CurrencyScreen
        params={params}
        onMintQuoteCreated={(mintHistoryEntry) => {
          router.replace({
            pathname: '/mintQuote',
            params: {
              mintHistoryEntry: JSON.stringify(mintHistoryEntry),
            },
          });
        }}
        onSendTokenCreated={(sendHistoryEntry, options) => {
          router.replace({
            pathname: '/sendToken',
            params: {
              sendHistoryEntry: JSON.stringify(sendHistoryEntry),
              ...(options?.nostrSent && { nostrSent: 'true' }),
            },
          });
        }}
        onMeltQuoteReady={(lnUrlOrAddress, amount) => {
          router.navigate({
            pathname: '/meltQuote',
            params: {
              lnUrlOrAddress,
              amount: String(amount),
            },
          });
        }}
        onCameraPress={(unit) => {
          router.navigate({
            pathname: '/camera',
            params: { unit },
          });
        }}
        onRoutstrSuccess={() => {
          // Dismiss the modal to return to the previous screen (UserMessages)
          router.dismiss();
        }}
        onDone={() => {
          // Used for flows that should return directly to the prior screen (e.g. P2PK Nostr send)
          router.dismiss();
        }}
        // Note: Payment request flow is handled entirely in CurrencyScreen
        // which calls onSendTokenCreated after successful Nostr send
        onInsufficientBalance={(amount, _unit) => {
          // Navigate to mint selection with minimum amount filter
          // This will hide mints that don't have sufficient balance
          router.navigate({
            pathname: '/(mint-flow)/list',
            params: {
              to: params.to || 'sendToken',
              minAmount: String(amount),
              amount: String(amount),
              showDetailsButton: 'false',
              showAddMintsButton: 'false',
            },
          });
        }}
        processPaymentStringFn={processPaymentString}
      />
    </>
  );
}

export default withSheetProvider(ModalScreen);
