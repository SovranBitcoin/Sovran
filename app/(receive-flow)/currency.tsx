/**
 * @fileoverview Receive flow currency route wrapper
 *
 * Part of the (receive-flow) modal group - displays with back button.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { CurrencyScreen } from 'components/screens/CurrencyScreen';
import { useProcessPaymentString } from '@/hooks/coco/useProcessPaymentString';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { ROUTSTR_PUBKEY } from 'helper/constants';

function ModalScreen() {
  const params = useLocalSearchParams<{
    amount?: string;
    unit: string;
    to: string;
    paymentRequest?: string;
    profile?: string;
    lud16?: string;
    allowedUnits?: string;
    mints?: string;
    lnUrlOrAddress?: string;
    routstrTopUp?: string;
  }>();
  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

  const { processPaymentString } = useProcessPaymentString({
    unit: params?.unit?.toLowerCase() || 'sat',
    selectedMint,
    isFocused: true,
    onLoading: () => {},
  });

  return (
    <>
      <Stack.Screen options={{ title: 'Select Amount' }} />
      <CurrencyScreen
        params={params}
        onMintQuoteCreated={(mintHistoryEntry) => {
          // Navigate within receive-flow (horizontal push)
          router.navigate({
            pathname: '/(receive-flow)/mintQuote',
            params: {
              mintHistoryEntry: JSON.stringify(mintHistoryEntry),
            },
          });
        }}
        onSendTokenCreated={(sendHistoryEntry) => {
          // sendToken is a separate flow, navigate to root-level screen
          router.replace({
            pathname: `/${params.to}` as any,
            params: {
              sendHistoryEntry: JSON.stringify(sendHistoryEntry),
            },
          });
        }}
        onMeltQuoteCreated={(meltQuote) => {
          // meltQuote is a separate flow, navigate to root-level screen
          router.navigate({
            pathname: `/${params.to}` as any,
            params: {
              meltQuote: JSON.stringify(meltQuote),
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
          router.replace({
            pathname: '/userMessages',
            params: { pubkey: ROUTSTR_PUBKEY },
          });
        }}
        processPaymentStringFn={processPaymentString}
      />
    </>
  );
}

export default withSheetProvider(ModalScreen);
