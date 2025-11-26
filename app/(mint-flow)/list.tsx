/**
 * @fileoverview Mint List screen for Mint Flow
 *
 * Entry point for mint management modal.
 * Shows owned mints with balances for selection.
 * Can navigate to add/info screens.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { View, VStack } from 'components/ui/View';
import { useTheme } from 'providers/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMintManagement } from 'hooks/coco';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { MintCurrencySelector } from 'components/blocks/sheets/mint-balance/MintCurrencySelector';
import { MintItem } from 'components/blocks/sheets/mint-balance/routes/list';
import { Mint } from 'coco-cashu-core';
import { useKYMMints } from 'hooks/coco/useKYMMints';
import { popup } from 'helper/popup';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { Host, Button as SwiftUIButton } from '@expo/ui/swift-ui';
import { frame } from '@expo/ui/swift-ui/modifiers';
import _ from 'lodash';

function MintListScreen() {
  const { getPrimaryColor, getGreenColor } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    requireBalance?: string;
    showAddMintsButton?: string;
    showDetailsButton?: string;
    onSelectAction?: string; // 'goBack' | 'continue'
    continuePathname?: string;
    continueParams?: string;
  }>();

  const requireBalance = params.requireBalance === 'true';
  const showAddMintsButton = params.showAddMintsButton !== 'false';
  const showDetailsButton = params.showDetailsButton !== 'false';
  const onSelectAction = params.onSelectAction || 'goBack';

  const { getBalances, mints } = useMintManagement();
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const setSelectedMint = useMintStore((state) => state.setSelectedMint);
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey;

  // Load balances
  useEffect(() => {
    let cancelled = false;
    const loadBalances = async () => {
      try {
        const newBalances = await getBalances();
        if (!cancelled) {
          setBalances(newBalances);
        }
      } catch (error) {
        if (__DEV__) {
          console.error('Failed to load balances:', error);
        }
        if (!cancelled) {
          setBalances({});
        }
      }
    };

    loadBalances();
    return () => {
      cancelled = true;
    };
  }, [getBalances]);

  // Process mints with balances
  const processedMints = useMemo(() => {
    if (mints.length === 0) return [];

    const mintsWithBalances = mints.map((mint) => ({
      unit: 'SAT',
      amount: balances[mint.mintUrl] || 0,
      ...mint,
    }));

    return _.orderBy(mintsWithBalances, ['amount'], ['desc']);
  }, [mints, balances]);

  // Fetch KYM scores
  const mintUrls = useMemo(() => processedMints.map((mint) => mint.mintUrl), [processedMints]);
  const { scores: kymScores, loading: kymLoading } = useKYMMints(mintUrls);

  const normalizeUrl = useCallback((url: string): string => {
    return url.replace(/\/$/, '');
  }, []);

  // Handle mint selection
  const handleMintSelect = useCallback(
    async (mintUrl: string) => {
      const mint = processedMints.find((m) => m.mintUrl === mintUrl);
      if (!mint) return;

      // Check if mint has balance (if required)
      if (requireBalance && mint.amount === 0) {
        popup({
          message: 'insufficient_balance',
          params: {
            amount: mint.amount,
            unit: mint.unit,
            fee: 0,
          },
        });
        return;
      }

      setLoadingId(mint.mintUrl);
      try {
        // Update selected mint in store
        if (pubkey) {
          setSelectedMint(pubkey, mint.mintUrl);
        }

        // Handle action based on context
        if (onSelectAction === 'continue' && params.continuePathname) {
          // Continue to next screen in a flow
          const continueParams = params.continueParams ? JSON.parse(params.continueParams) : {};
          router.push({
            pathname: params.continuePathname as any,
            params: {
              ...continueParams,
              unit: mint.unit.toLowerCase(),
            },
          });
        } else {
          // Default: dismiss and go back
          router.dismissAll();
        }
      } catch (e) {
        popup({
          message: 'general_error',
          emoji: '🚨',
        });
      } finally {
        setLoadingId(null);
      }
    },
    [
      processedMints,
      pubkey,
      setSelectedMint,
      requireBalance,
      onSelectAction,
      params.continuePathname,
      params.continueParams,
    ]
  );

  // Handle add mints
  const handleAddMints = useCallback(() => {
    router.push('/(mint-flow)/add');
  }, []);

  // Handle inspect mint
  const handleInspectMint = useCallback((mintUrl: string) => {
    router.push({
      pathname: '/(mint-flow)/info',
      params: { mintUrl },
    });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
      <Stack.Screen
        options={{
          title: 'Select Mint',
          headerRight: () =>
            showAddMintsButton ? (
              <Host matchContents>
                <SwiftUIButton
                  variant="glass"
                  systemImage="plus"
                  color={getGreenColor('300')}
                  onPress={handleAddMints}
                  modifiers={[
                    frame({
                      width: 36,
                      height: 36,
                      alignment: 'center',
                    }),
                  ]}
                />
              </Host>
            ) : null,
        }}
      />
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + 48,
          paddingHorizontal: 16,
        }}>
        <MintCurrencySelector
          mints={processedMints}
          allowedCurrencies={['SAT', 'USD', 'EUR', 'GBP']}
          currencyLabel="Currency"
          mintsLabel="Your mints"
          renderItem={useCallback(
            (mint: Mint & { amount: number; unit: string }, selectedCurrency: string) => {
              const normalizedUrl = normalizeUrl(mint.mintUrl);
              const kymData = kymScores[normalizedUrl];
              const kymScore = kymData?.score;
              return (
                <MintItem
                  key={mint.mintUrl}
                  mint={mint}
                  balance={{ amount: mint.amount, unit: mint.unit }}
                  isLoading={loadingId === mint.mintUrl}
                  globalLoading={loadingId !== null}
                  requireBalance={requireBalance}
                  showDetailsButton={showDetailsButton}
                  onInspectPress={() => handleInspectMint(mint.mintUrl)}
                  selectedCurrency={selectedCurrency}
                  kymScore={kymScore}
                  kymLoading={kymLoading}
                  onPress={() => handleMintSelect(mint.mintUrl)}
                />
              );
            },
            [
              loadingId,
              requireBalance,
              showDetailsButton,
              handleMintSelect,
              handleInspectMint,
              kymScores,
              kymLoading,
              normalizeUrl,
            ]
          )}
        />
      </View>
      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: 'Close',
              variant: 'secondary' as const,
              onPress: async () => router.back(),
            },
          ]}
        />
      </BottomButtons>
    </View>
  );
}

export default withSheetProvider(MintListScreen);

