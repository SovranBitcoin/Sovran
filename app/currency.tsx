/**
 * @fileoverview Standalone currency route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 */

import React, { useCallback } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { CurrencyScreen } from '@/features/send';
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
      <CurrencyScreen
        params={params}
        onMintQuoteCreated={(mintHistoryEntry) => {
          router.replace({
            pathname: `/${params.to}` as any,
            params: {
              mintHistoryEntry: JSON.stringify(mintHistoryEntry),
            },
          });
        }}
        onSendTokenCreated={(sendHistoryEntry) => {
          router.replace({
            pathname: `/${params.to}` as any,
            params: {
              sendHistoryEntry: JSON.stringify(sendHistoryEntry),
            },
          });
        }}
        onMeltQuoteReady={(lnUrlOrAddress, amount) => {
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
