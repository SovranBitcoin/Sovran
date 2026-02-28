/**
 * @fileoverview Mint List screen for Mint Flow
 *
 * Entry point for mint management modal.
 * Shows owned mints with balances for selection.
 * Uses native header with liquid glass buttons for iOS feel.
 * Can navigate to add/info screens.
 */

import React from 'react';
import { Stack, router, useLocalSearchParams, Link } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { useThemeColor } from '@/hooks/useThemeColor';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { MintListScreen } from 'components/screens/MintListScreen';
import Icon from 'assets/icons';

function MintListRoute() {
  const foreground = useThemeColor('foreground');
  const params = useLocalSearchParams<{
    requireBalance?: string;
    showAddMintsButton?: string;
    showDetailsButton?: string;
    onSelectAction?: string;
    continuePathname?: string;
    continueParams?: string;
    // Send flow params for insufficient balance redirect
    minAmount?: string;
    amount?: string;
    to?: string;
    // Payment request params for filtering mints
    allowedMints?: string; // JSON array of allowed mint URLs
  }>();

  const requireBalance = params.requireBalance === 'true';
  const showAddMintsButton = params.showAddMintsButton !== 'false';
  const showDetailsButton = params.showDetailsButton !== 'false';
  const onSelectAction = params.onSelectAction || 'goBack';
  // Parse minAmount for filtering mints with insufficient balance
  const minAmount = params.minAmount ? parseInt(params.minAmount, 10) : undefined;
  // Parse allowedMints for payment request filtering
  const allowedMints = params.allowedMints ? JSON.parse(params.allowedMints) : undefined;

  return (
    <>
      {/* Native header - transparent to match other flows */}
      <Stack.Screen
        options={{
          title: 'Select Mint',
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerRight: () =>
            showAddMintsButton ? (
              <Link href="/add" asChild>
                <TouchableOpacity style={{ padding: 8 }}>
                  <Icon name="fluent:add-24-filled" size={24} color={foreground} />
                </TouchableOpacity>
              </Link>
            ) : null,
        }}
      />

      <MintListScreen
        requireBalance={requireBalance || !!minAmount}
        minAmount={minAmount}
        allowedMints={allowedMints}
        showDetailsButton={showDetailsButton}
        currencyLabel="Currency"
        mintsLabel="Your mints"
        closeButtonLabel="Close"
        onMintSelect={(mint) => {
          if (onSelectAction === 'continue' && params.continuePathname) {
            const continueParams = params.continueParams ? JSON.parse(params.continueParams) : {};
            router.navigate({
              pathname: params.continuePathname as any,
              params: {
                ...continueParams,
                unit: mint.unit.toLowerCase(),
              },
            });
          } else {
            router.dismiss();
          }
        }}
        onInspectMint={(mintUrl) => {
          router.navigate({
            pathname: '/info',
            params: { mintUrl },
          });
        }}
        onClose={() => router.back()}
      />
    </>
  );
}

export default withSheetProvider(MintListRoute);
