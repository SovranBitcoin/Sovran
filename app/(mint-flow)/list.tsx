/**
 * @fileoverview Mint List screen for Mint Flow
 *
 * Entry point for mint management modal.
 * Shows owned mints with balances for selection.
 * Can navigate to add/info screens.
 */

import React from 'react';
import { Stack, router, useLocalSearchParams, Link } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { MintListScreen } from 'components/screens/MintListScreen';
import Icon from 'assets/icons';

function MintListRoute() {
  const { getPrimaryColor } = useTheme();
  const params = useLocalSearchParams<{
    requireBalance?: string;
    showAddMintsButton?: string;
    showDetailsButton?: string;
    onSelectAction?: string;
    continuePathname?: string;
    continueParams?: string;
  }>();

  const requireBalance = params.requireBalance === 'true';
  const showAddMintsButton = params.showAddMintsButton !== 'false';
  const showDetailsButton = params.showDetailsButton !== 'false';
  const onSelectAction = params.onSelectAction || 'goBack';

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Select Mint',
          headerRight: () =>
            showAddMintsButton ? (
              <Link href="/add" asChild>
                <TouchableOpacity style={{ padding: 8 }}>
                  <Icon name="fluent:add-24-filled" size={24} color={getPrimaryColor('0')} />
                </TouchableOpacity>
              </Link>
            ) : null,
        }}
      />
      <MintListScreen
        requireBalance={requireBalance}
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
            router.back();
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
