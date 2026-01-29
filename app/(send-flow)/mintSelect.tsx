/**
 * @fileoverview Mint Selection screen for Send Flow
 *
 * Entry point when user has no balance on current mint.
 * Shows list of mints with balances to select from.
 * After selection, navigates horizontally to currency screen.
 *
 * Also supports NFC Lightning flow - when invoice param is provided,
 * creates a melt quote to validate fees before navigating to meltQuote.
 * The pre-created quote is passed to meltQuote to avoid duplicate creation.
 */

import React, { useCallback } from 'react';
import { Alert } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { MintListScreen } from 'components/screens/MintListScreen';
import { useMeltWithHistory } from '@/hooks/coco/useMeltWithHistory';
import { useScanHistoryStore } from 'stores/scanHistoryStore';
import { captureAndStoreLocation } from '@/hooks/useTransactionLocation';
import type { Mint } from 'coco-cashu-core';

function MintSelectRoute() {
  const { prepareMeltQuote } = useMeltWithHistory();
  const params = useLocalSearchParams<{
    unit?: string;
    to?: string;
    minAmount?: string;
    amount?: string;
    invoice?: string; // Lightning invoice from NFC scan
    paymentRequest?: string; // NUT-18 payment request (creqA...)
    allowedMints?: string; // JSON array of allowed mint URLs (for payment requests with specified mints)
  }>();

  // Parse minAmount from params (filters out mints with insufficient balance)
  const minAmount = params.minAmount ? parseInt(params.minAmount, 10) : undefined;

  // Parse allowedMints from params (only show mints in this list)
  const allowedMints = params.allowedMints ? JSON.parse(params.allowedMints) : undefined;

  // Handle mint selection
  const handleMintNavigation = useCallback(
    async (mint: Mint & { amount: number; unit: string }) => {
      // Check if coming from NFC Lightning scan with invoice
      if (params.to === 'meltQuote' && params.invoice) {
        try {
          // Create melt quote to get actual fees and history entry
          const { quote, historyEntry } = await prepareMeltQuote(mint.mintUrl, params.invoice);
          const totalRequired = quote.amount + quote.fee_reserve;

          if (mint.amount >= totalRequired) {
            // Capture location and link scan to transaction only when proceeding
            await captureAndStoreLocation(historyEntry.id);
            useScanHistoryStore.getState().linkTransaction(params.invoice, historyEntry.id);

            // Sufficient balance including fees - navigate to meltQuote with pre-created quote
            router.navigate({
              pathname: '/meltQuote',
              params: {
                meltHistoryEntry: JSON.stringify(historyEntry),
                invoice: params.invoice, // Pass invoice for mint change re-creation
              },
            });
          } else {
            // Insufficient balance when including fees
            Alert.alert(
              'Insufficient Balance',
              `This payment requires ${totalRequired} sats (${quote.amount} + ${quote.fee_reserve} fee reserve), but this mint only has ${mint.amount} sats.`,
              [{ text: 'OK' }]
            );
          }
        } catch (error) {
          Alert.alert(
            'Quote Failed',
            error instanceof Error ? error.message : 'Failed to create quote',
            [{ text: 'OK' }]
          );
        }
      } else if (params.to === 'paymentRequest' && params.paymentRequest && params.minAmount) {
        // Payment request with amount specified - go directly to SendTokenScreen in payment request mode
        router.navigate({
          pathname: '/sendToken',
          params: {
            paymentRequest: params.paymentRequest,
            amount: params.minAmount,
            selectedMintUrl: mint.mintUrl,
          },
        });
      } else if (params.to === 'currency' && params.paymentRequest) {
        // Payment request without amount - go to currency screen first
        router.navigate({
          pathname: '/currency',
          params: {
            to: 'paymentRequest',
            paymentRequest: params.paymentRequest,
            unit: mint.unit.toLowerCase(),
          },
        });
      } else {
        // Normal flow - go to currency screen
        router.navigate({
          pathname: '/currency',
          params: {
            to: params.to || 'sendToken',
            unit: mint.unit.toLowerCase(),
            // Preserve the amount if coming from currency screen with insufficient balance
            ...(params.amount && { amount: params.amount }),
            // Forward payment request if present (for NUT-18 flow)
            ...(params.paymentRequest && { paymentRequest: params.paymentRequest }),
          },
        });
      }
    },
    [params, prepareMeltQuote]
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Select Mint' }} />
      <MintListScreen
        requireBalance={true}
        minAmount={minAmount}
        allowedMints={allowedMints}
        showDetailsButton={false}
        currencyLabel="Send payment in"
        mintsLabel="Send from"
        closeButtonLabel="Cancel"
        onMintSelect={handleMintNavigation}
        onClose={() => router.back()}
      />
    </>
  );
}

export default withSheetProvider(MintSelectRoute);
