/**
 * @fileoverview Receive flow currency route wrapper
 *
 * Part of the (receive-flow) modal group - displays with back button.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { CurrencyScreen, useProcessPaymentString } from '@/features/send';
import { WalletHeaderTitle } from '@/features/wallet';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import {
  getHeaderTitleWidth,
  getHeaderTitleHeight,
  getHeaderContentWidth,
  getHeaderContentHeight,
} from '@/features/wallet/lib/walletHeader';

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
      <Stack.Screen
        options={{
          title: 'Select Amount',
          headerTitleAlign: 'center',
          headerTitle: () => (
            <WalletHeaderTitle
              liquidGlass
              unit={params?.unit?.toLowerCase() || 'sat'}
              style={{ width: getHeaderTitleWidth(), height: getHeaderTitleHeight() }}
              contentWidth={getHeaderContentWidth()}
              contentHeight={getHeaderContentHeight()}
              requireBalance={params?.to === 'sendToken' || params?.to === 'meltQuote'}
              showAddMintsButton={!(params?.to === 'sendToken' || params?.to === 'meltQuote')}
              showDetailsButton={!(params?.to === 'sendToken' || params?.to === 'meltQuote')}
            />
          ),
        }}
      />
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
        onSendTokenCreated={(sendHistoryEntry) => {
          // sendToken is a separate flow, navigate to root-level screen
          router.replace({
            pathname: `/${params.to}` as any,
            params: {
              sendHistoryEntry: JSON.stringify(sendHistoryEntry),
            },
          });
        }}
        onMeltQuoteReady={(lnUrlOrAddress, amount) => {
          // meltQuote is a separate flow, navigate to root-level screen
          router.navigate({
            pathname: `/${params.to}` as any,
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
        processPaymentStringFn={processPaymentString}
      />
    </>
  );
}

export default withSheetProvider(ModalScreen);
