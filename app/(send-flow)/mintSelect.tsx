/**
 * @fileoverview Mint Selection screen for Send Flow
 *
 * Entry point when user has no balance on current mint.
 * Shows list of mints with balances to select from.
 * After selection, navigates horizontally to currency screen.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { View, VStack, HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
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
import _ from 'lodash';

function MintSelectScreen() {
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ unit?: string; to?: string }>();

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

      // Check if mint has balance (require balance for sending)
      if (mint.amount === 0) {
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

        // Navigate to currency screen (horizontal push within the flow)
        router.push({
          pathname: '/(send-flow)/currency',
          params: {
            to: params.to || 'sendToken',
            unit: mint.unit.toLowerCase(),
          },
        });
      } catch (e) {
        popup({
          message: 'general_error',
          emoji: '🚨',
        });
      } finally {
        setLoadingId(null);
      }
    },
    [processedMints, pubkey, setSelectedMint, params.to]
  );

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
      <Stack.Screen options={{ title: 'Select Mint' }} />
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + 48,
          paddingHorizontal: 16,
        }}>
        <MintCurrencySelector
          mints={processedMints}
          allowedCurrencies={['SAT', 'USD', 'EUR', 'GBP']}
          currencyLabel="Send payment in"
          mintsLabel="Send from"
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
                  requireBalance={true}
                  showDetailsButton={false}
                  selectedCurrency={selectedCurrency}
                  kymScore={kymScore}
                  kymLoading={kymLoading}
                  onPress={() => handleMintSelect(mint.mintUrl)}
                />
              );
            },
            [loadingId, handleMintSelect, kymScores, kymLoading, normalizeUrl]
          )}
        />
      </View>
      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: 'Cancel',
              variant: 'secondary',
              onPress: async () => router.back(),
            },
          ]}
        />
      </BottomButtons>
    </View>
  );
}

export default withSheetProvider(MintSelectScreen);

