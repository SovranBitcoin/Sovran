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

import React from 'react';
import { Alert } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { MintListScreen } from 'components/screens/MintListScreen';
import { useMeltWithHistory } from '@/hooks/coco/useMeltWithHistory';
import { useScanHistoryStore } from 'stores/scanHistoryStore';
import { captureAndStoreLocation } from '@/hooks/useTransactionLocation';

function MintSelectRoute() {
  const { createMeltQuote } = useMeltWithHistory();
  const params = useLocalSearchParams<{
    unit?: string;
    to?: string;
    minAmount?: string;
    amount?: string;
    invoice?: string; // Lightning invoice from NFC scan
  }>();

  // Parse minAmount from params (filters out mints with insufficient balance)
  const minAmount = params.minAmount ? parseInt(params.minAmount, 10) : undefined;

  return (
    <>
      <Stack.Screen options={{ title: 'Select Mint' }} />
      <MintListScreen
        requireBalance={true}
        minAmount={minAmount}
        showDetailsButton={false}
        currencyLabel="Send payment in"
        mintsLabel="Send from"
        closeButtonLabel="Cancel"
        onMintSelect={async (mint) => {
          // Check if coming from NFC Lightning scan with invoice
          if (params.to === 'meltQuote' && params.invoice) {
            try {
              // Create melt quote to get actual fees and history entry
              const { quote, historyEntry } = await createMeltQuote(mint.mintUrl, params.invoice);
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
          } else {
            // Normal flow - go to currency screen
            router.navigate({
              pathname: '/currency',
              params: {
                to: params.to || 'sendToken',
                unit: mint.unit.toLowerCase(),
                // Preserve the amount if coming from currency screen with insufficient balance
                ...(params.amount && { amount: params.amount }),
              },
            });
          }
        }}
        onClose={() => router.back()}
      />
    </>
  );
}

export default withSheetProvider(MintSelectRoute);
