/**
 * @fileoverview Shared Mint List screen component
 *
 * This module provides the core UI and logic for mint selection.
 * It is used by both the mint-flow list and send-flow mintSelect routes.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View } from 'components/ui/View';
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
import _ from 'lodash';

export interface MintListScreenProps {
  /** Whether to require balance for selection (default: false) */
  requireBalance?: boolean;
  /** Whether to show the details/inspect button on each mint (default: true) */
  showDetailsButton?: boolean;
  /** Label for currency selector (default: "Currency") */
  currencyLabel?: string;
  /** Label for mints list (default: "Your mints") */
  mintsLabel?: string;
  /** Label for close/cancel button (default: "Close") */
  closeButtonLabel?: string;
  /** Called when a mint is selected. Return true to allow default behavior (router.back) */
  onMintSelect: (mint: Mint & { amount: number; unit: string }) => void | Promise<void>;
  /** Called when inspect/details button is pressed on a mint */
  onInspectMint?: (mintUrl: string) => void;
  /** Called when close/cancel button is pressed */
  onClose: () => void;
  /** Header right component (e.g., add button) */
  headerRight?: React.ReactNode;
}

export function MintListScreen({
  requireBalance = false,
  showDetailsButton = true,
  currencyLabel = 'Currency',
  mintsLabel = 'Your mints',
  closeButtonLabel = 'Close',
  onMintSelect,
  onInspectMint,
  onClose,
  headerRight,
}: MintListScreenProps) {
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();

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
      // Prevent rapid button presses
      if (loadingId !== null) return;

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

        // Call the provided handler
        await onMintSelect(mint);
      } catch {
        popup({
          message: 'general_error',
          emoji: '🚨',
        });
      } finally {
        setLoadingId(null);
      }
    },
    [processedMints, pubkey, setSelectedMint, requireBalance, onMintSelect, loadingId]
  );

  // Handle inspect mint
  const handleInspectMint = useCallback(
    (mintUrl: string) => {
      onInspectMint?.(mintUrl);
    },
    [onInspectMint]
  );

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + 48,
          paddingHorizontal: 16,
        }}>
        <MintCurrencySelector
          mints={processedMints}
          allowedCurrencies={['SAT', 'USD', 'EUR', 'GBP']}
          currencyLabel={currencyLabel}
          mintsLabel={mintsLabel}
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
                  onInspectPress={onInspectMint ? () => handleInspectMint(mint.mintUrl) : undefined}
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
              onInspectMint,
            ]
          )}
        />
      </View>
      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: closeButtonLabel,
              variant: 'secondary' as const,
              onPress: async () => onClose(),
            },
          ]}
        />
      </BottomButtons>
    </View>
  );
}

