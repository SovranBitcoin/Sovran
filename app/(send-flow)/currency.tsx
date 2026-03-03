/**
 * @fileoverview Send flow currency route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * Uses useProcessPaymentString hook for payment processing.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, TouchableOpacity } from 'react-native';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { CurrencyScreen, useProcessPaymentString } from '@/features/send';
import { WalletHeaderTitle } from '@/features/wallet';
import Icon from 'assets/icons';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import {
  getHeaderTitleWidth,
  getHeaderTitleHeight,
  getHeaderContentWidth,
  getHeaderContentHeight,
} from '@/features/wallet/lib/walletHeader';

type SendMode = 'offline' | 'online';

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
    selectedMintUrl?: string; // Pre-selected mint URL (for payment requests with single valid mint)
    allowedMints?: string; // JSON array of allowed mint URLs (for payment requests)
  }>();

  const { keys } = useNostrKeysContext();
  const foreground = useThemeColor('foreground');
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;
  const [sendMode, setSendMode] = useState<SendMode | null>(null);
  const allowedMints = useMemo(() => {
    if (!params.allowedMints) return undefined;
    try {
      return JSON.parse(params.allowedMints) as string[];
    } catch {
      return undefined;
    }
  }, [params.allowedMints]);

  const { processPaymentString } = useProcessPaymentString({
    unit: params?.unit?.toLowerCase() || 'sat',
    selectedMint,
    isFocused: true,
  });
  const showSendModeIcon = params.to === 'sendToken';

  const handlePressSendModeInfo = useCallback(() => {
    if (!sendMode) {
      Alert.alert(
        'Checking route',
        'Determining whether this send can go offline (no swap) or needs an online swap.'
      );
      return;
    }
    if (sendMode === 'offline') {
      Alert.alert(
        'Offline send',
        'This amount can be sent directly with existing proofs, so no swap is required.'
      );
      return;
    }
    Alert.alert(
      'Online send',
      'This amount requires a mint swap to construct the exact send proofs before sending.'
    );
  }, [sendMode]);

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
              allowedMints={allowedMints}
            />
          ),
          headerRight: showSendModeIcon
            ? () => (
                <TouchableOpacity onPress={handlePressSendModeInfo} className="p-2">
                  <Icon
                    name={
                      sendMode === 'offline'
                        ? 'mdi:airplane'
                        : sendMode === 'online'
                          ? 'feather:wifi'
                          : 'fluent:clock-12-filled'
                    }
                    size={22}
                    color={foreground}
                  />
                </TouchableOpacity>
              )
            : undefined,
          headerTintColor: foreground,
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
        onSendModeChange={setSendMode}
      />
    </>
  );
}

export default withSheetProvider(ModalScreen);
