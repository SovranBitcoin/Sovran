/**
 * @fileoverview Receive flow currency route wrapper
 *
 * Part of the (receive-flow) modal group - displays with back button.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Dimensions } from 'react-native';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { CurrencyScreen } from 'components/screens/CurrencyScreen';
import WalletHeaderTitle from 'components/blocks/WalletHeaderTitle';
import { useProcessPaymentString } from '@/hooks/coco/useProcessPaymentString';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';

const HEADER_LAYOUT = {
  TOOLBAR_BUTTON_WIDTH: 44,
  HORIZONTAL_PADDING: 16,
  BUTTON_SPACING: 12,
  BUTTON_HEIGHT: 54,
  CONTENT_PADDING_HORIZONTAL: 16,
  CONTENT_PADDING_VERTICAL: 14,
} as const;

const getHeaderTitleWidth = () => {
  const windowWidth = Dimensions.get('window').width;
  const leftSide =
    HEADER_LAYOUT.TOOLBAR_BUTTON_WIDTH +
    HEADER_LAYOUT.HORIZONTAL_PADDING +
    HEADER_LAYOUT.BUTTON_SPACING;
  const rightSide =
    HEADER_LAYOUT.TOOLBAR_BUTTON_WIDTH +
    HEADER_LAYOUT.HORIZONTAL_PADDING +
    HEADER_LAYOUT.BUTTON_SPACING;
  return windowWidth - leftSide - rightSide;
};

const getHeaderTitleHeight = () => HEADER_LAYOUT.BUTTON_HEIGHT;
const getHeaderContentWidth = () =>
  getHeaderTitleWidth() - HEADER_LAYOUT.CONTENT_PADDING_HORIZONTAL;
const getHeaderContentHeight = () =>
  getHeaderTitleHeight() - HEADER_LAYOUT.CONTENT_PADDING_VERTICAL;

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
