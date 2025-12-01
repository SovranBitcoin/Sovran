/**
 * @fileoverview Shared PaymentRequest confirmation screen component
 *
 * This module provides the UI and logic for confirming NUT-18 payment requests.
 * It displays the payment request details and allows the user to confirm before sending.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ScrollView } from 'react-native';
import { useMintManagement, usePaymentRequest, useManager } from 'hooks/coco';
import type { PreparedPaymentRequest } from 'hooks/coco';
import { VStack, HStack, View } from 'components/ui/View';
import WalletHeaderTitle from 'components/blocks/WalletHeaderTitle';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { useMintStore } from '@/stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { SendHistoryEntry } from 'coco-cashu-core';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import { Spinner } from 'components/ui/Spinner';
import { BottomButtons } from 'components/ui/BottomButtons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { popup } from '@/helper/popup';
import { getEncodedToken, Token } from '@cashu/cashu-ts';
import CustomKeyboard from 'components/blocks/CustomKeyboard';
import { AmountFormatter } from 'components/ui/AmountFormatter';

export interface PaymentRequestScreenProps {
  /** The encoded payment request string (creq...) */
  paymentRequest: string | undefined;
  /** Called when the user cancels */
  onCancel: () => void;
  /** Called when the payment is completed, with the send history entry */
  onPaymentCompleted: (sendHistoryEntry: SendHistoryEntry) => void;
}

export function PaymentRequestScreen({
  paymentRequest: paymentRequestProp,
  onCancel,
  onPaymentCompleted,
}: PaymentRequestScreenProps) {
  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;
  const { readPaymentRequest, handleInbandPaymentRequest, handleHttpPaymentRequest, isLoading } =
    usePaymentRequest();
  const { getBalances } = useMintManagement();
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();
  const manager = useManager();

  const [preparedRequest, setPreparedRequest] = useState<PreparedPaymentRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<{ [mintUrl: string]: number }>({});
  const [customAmount, setCustomAmount] = useState<number>(0);
  const [isSending, setIsSending] = useState(false);

  // Parse and decode the payment request
  useEffect(() => {
    const decodeRequest = async () => {
      if (!paymentRequestProp) {
        setError('Missing payment request');
        setLoading(false);
        return;
      }

      try {
        const prepared = await readPaymentRequest(paymentRequestProp);
        setPreparedRequest(prepared);

        // Load balances
        const balanceData = await getBalances();
        setBalances(balanceData);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to decode payment request';
        setError(errorMessage);
        console.error('Failed to decode payment request:', err);
      } finally {
        setLoading(false);
      }
    };

    decodeRequest();
  }, [paymentRequestProp, readPaymentRequest, getBalances]);

  // Check if the selected mint is valid for this payment request
  const isMintValid = useMemo(() => {
    if (!preparedRequest || !selectedMint) return false;
    // If no mints specified, any mint is valid
    if (!preparedRequest.mints || preparedRequest.mints.length === 0) return true;
    return preparedRequest.mints.includes(selectedMint);
  }, [preparedRequest, selectedMint]);

  // Get the final amount (from request or custom input)
  const finalAmount = useMemo(() => {
    return preparedRequest?.amount ?? customAmount;
  }, [preparedRequest?.amount, customAmount]);

  // Check if we have sufficient balance
  const hasSufficientBalance = useMemo(() => {
    if (!selectedMint || !finalAmount) return false;
    const balance = balances[selectedMint] || 0;
    return balance >= finalAmount;
  }, [selectedMint, finalAmount, balances]);

  // Handle mint selection
  const handleMintSelected = useCallback(
    async (mint: { id: string; unit: string }) => {
      // The WalletHeaderTitle component handles the actual mint selection
      // We just need to reload balances after selection
      const balanceData = await getBalances();
      setBalances(balanceData);
    },
    [getBalances]
  );

  // Handle payment
  const handlePayment = useCallback(async () => {
    if (!preparedRequest || !selectedMint || !finalAmount) {
      popup({ message: 'Invalid payment request or no mint selected', emoji: '🚨', type: 'error' });
      return;
    }

    if (!isMintValid) {
      popup({
        message: 'Selected mint is not allowed for this payment request',
        emoji: '🚨',
        type: 'error',
      });
      return;
    }

    if (!hasSufficientBalance) {
      popup({ message: 'Insufficient balance', emoji: '🚨', type: 'error' });
      return;
    }

    setIsSending(true);

    try {
      let sentToken: Token | undefined;

      if (preparedRequest.transport.type === 'inband') {
        // For inband, we capture the token to show in SendTokenScreen
        await handleInbandPaymentRequest(
          selectedMint,
          preparedRequest,
          async (token) => {
            sentToken = token;
          },
          preparedRequest.amount ? undefined : finalAmount
        );
      } else if (preparedRequest.transport.type === 'http') {
        // For HTTP, the token is sent to the URL automatically
        const response = await handleHttpPaymentRequest(
          selectedMint,
          preparedRequest,
          preparedRequest.amount ? undefined : finalAmount
        );

        if (!response.ok) {
          throw new Error(`HTTP request failed with status ${response.status}`);
        }

        // For HTTP, we need to get the token from history since it was sent internally
        // The token was already sent, so we look it up in history
        const history = await manager.history.getPaginatedHistory();
        const sendEntry = history.find(
          (h): h is SendHistoryEntry =>
            h.type === 'send' &&
            h.amount === finalAmount &&
            h.mintUrl === selectedMint &&
            Date.now() - h.createdAt < 5000 // Within last 5 seconds
        );

        if (sendEntry) {
          sentToken = sendEntry.token;
        }
      }

      // Find the send history entry
      const history = await manager.history.getPaginatedHistory();
      const sendHistoryEntry = history.find(
        (h): h is SendHistoryEntry =>
          h.type === 'send' &&
          sentToken !== undefined &&
          getEncodedToken(h.token) === getEncodedToken(sentToken)
      );

      if (sendHistoryEntry) {
        popup({ message: 'Payment sent successfully', emoji: '✅', type: 'success' });
        onPaymentCompleted(sendHistoryEntry);
      } else {
        // Even if we can't find the exact entry, the payment was successful
        popup({ message: 'Payment sent successfully', emoji: '✅', type: 'success' });
        onCancel();
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send payment';
      popup({ message: errorMessage, emoji: '🚨', type: 'error' });
      console.error('Failed to send payment:', err);
    } finally {
      setIsSending(false);
    }
  }, [
    preparedRequest,
    selectedMint,
    finalAmount,
    isMintValid,
    hasSufficientBalance,
    handleInbandPaymentRequest,
    handleHttpPaymentRequest,
    manager,
    onPaymentCompleted,
    onCancel,
  ]);

  // Loading state
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
        <VStack style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Spinner size={32} />
          <Text
            size={16}
            style={{
              color: getPrimaryColor('300'),
              marginTop: 16,
            }}>
            Loading payment request...
          </Text>
        </VStack>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
        <VStack style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text
            size={18}
            bold
            style={{
              color: getPrimaryColor('0'),
              marginBottom: 16,
              textAlign: 'center',
            }}>
            Error Loading Payment Request
          </Text>
          <Text
            size={14}
            style={{
              color: getPrimaryColor('300'),
              marginBottom: 24,
              textAlign: 'center',
            }}>
            {error}
          </Text>
          <Text
            size={14}
            style={{
              color: getPrimaryColor('400'),
              textAlign: 'center',
            }}
            onPress={() => onCancel()}>
            Tap to go back
          </Text>
        </VStack>
      </View>
    );
  }

  if (!preparedRequest) {
    return null;
  }

  const transportLabel = preparedRequest.transport.type === 'inband' ? 'Direct' : 'HTTP';
  const needsAmountInput = preparedRequest.amount === undefined;

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 48,
          paddingBottom: needsAmountInput ? 300 : 120,
        }}>
        <VStack gap={12}>
          {/* Amount Display */}
          <AmountFormatter
            amount={finalAmount}
            unit="sat"
            size={48}
            weight="heavy"
            animated
            useTypeColors
            transactionType="send"
            centered
          />

          {/* Mint Selector */}
          <View style={{ marginVertical: 8 }}>
            <WalletHeaderTitle
              width={280}
              unit="sat"
              requireBalance
              onMintSelected={handleMintSelected}
            />
          </View>

          {/* Validation Messages */}
          {!isMintValid && selectedMint && (
            <View style={{ paddingHorizontal: 20 }}>
              <Text
                size={14}
                style={{
                  color: getPrimaryColor('500'),
                  textAlign: 'center',
                }}>
                Selected mint is not allowed for this payment request
              </Text>
            </View>
          )}

          {!hasSufficientBalance && selectedMint && finalAmount > 0 && (
            <View style={{ paddingHorizontal: 20 }}>
              <Text
                size={14}
                style={{
                  color: getPrimaryColor('500'),
                  textAlign: 'center',
                }}>
                Insufficient balance ({balances[selectedMint] || 0} sats available)
              </Text>
            </View>
          )}

          {/* Payment Request Details */}
          <Section
            items={[
              {
                title: 'Type',
                value: 'Payment Request',
              },
              {
                title: 'Transport',
                value: transportLabel,
              },
              ...(preparedRequest.transport.type === 'http'
                ? [
                    {
                      title: 'Destination',
                      value: new URL(preparedRequest.transport.url).hostname,
                    },
                  ]
                : []),
              ...(preparedRequest.mints && preparedRequest.mints.length > 0
                ? [
                    {
                      title: 'Allowed Mints',
                      value: `${preparedRequest.mints.length} mint${preparedRequest.mints.length > 1 ? 's' : ''}`,
                    },
                  ]
                : []),
              {
                title: 'Amount',
                value: preparedRequest.amount
                  ? `${preparedRequest.amount} SAT`
                  : 'Not specified (enter below)',
              },
            ]}
          />
        </VStack>
      </ScrollView>

      <BottomButtons>
        {/* Custom Amount Keyboard (if amount not specified) */}
        {needsAmountInput && (
          <CustomKeyboard
            loading={isSending}
            unit="sat"
            onKeyPress={(value: string) => setCustomAmount(parseFloat(value) || 0)}
          />
        )}

        <HStack className="pb-2" justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                text: 'Cancel',
                icon: 'ri:close-circle-line',
                variant: 'secondary',
                onPress: async () => onCancel(),
              },
              {
                text: isSending ? 'Sending...' : 'Send',
                icon: isSending ? 'ri:loader-line' : 'ri:send-plane-2-fill',
                variant: 'primary',
                onPress: async () => handlePayment(),
                disabled: isSending || !finalAmount || !isMintValid || !hasSufficientBalance,
              },
            ]}
          />
        </HStack>
      </BottomButtons>
    </View>
  );
}



