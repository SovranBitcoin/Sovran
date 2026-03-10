/**
 * @fileoverview Receive flow currency route wrapper
 *
 * Part of the (receive-flow) modal group - displays with back button.
 */

import React, { useCallback } from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { CurrencyScreen } from '@/features/send';
import { WalletHeaderTitle } from '@/features/wallet';
import {
  getHeaderTitleWidth,
  getHeaderTitleHeight,
  getHeaderContentWidth,
  getHeaderContentHeight,
} from '@/features/wallet/lib/walletHeader';
import { usePaymentMachine } from '@/shared/hooks/usePaymentMachine';

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

  const { scan } = usePaymentMachine();

  const processPaymentString = useCallback(
    async (scanning: { data: string; type?: string }) => {
      const source =
        scanning.type === 'paste' || scanning.type === 'deeplink' ? scanning.type : 'qr';
      return scan(scanning.data, source);
    },
    [scan]
  );

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

export default ModalScreen;
