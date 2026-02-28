/**
 * @fileoverview Shared Mint List screen component
 *
 * This module provides the core UI and logic for mint selection.
 * It is used by both the mint-flow list and send-flow mintSelect routes.
 *
 * Features:
 * - Native Stack header handles title and buttons
 * - Sticky animated currency tabs below header
 * - Full-page scrolling mint list
 * - Uses ModalLayoutWrapper for consistent modal styling
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { LegendList, type NativeScrollEvent, type NativeSyntheticEvent } from '@legendapp/list';
import { View } from 'components/ui/View/View';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import opacity from 'hex-color-opacity';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { MintItem } from 'components/blocks/sheets/mint-balance/routes/list';
import { MintCurrencyTabs } from 'components/blocks/sheets/mint-balance/MintCurrencyTabs';
import { ModalLayoutWrapper } from 'app/debugModal';
import { Mint } from 'coco-cashu-core';
import { useKYMMints } from 'hooks/coco/useKYMMints';
import { popup } from 'helper/popup';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import _ from 'lodash';
import { useMints } from 'coco-cashu-react';
import { useMintManagement } from '@/hooks/coco/useMintManagement';

// Height constant for currency tabs
const CURRENCY_TABS_HEIGHT = 48;

interface MintListScreenProps {
  /** Whether to require balance for selection (default: false) */
  requireBalance?: boolean;
  /** Minimum balance required for mint selection (filters out mints below this amount) */
  minAmount?: number;
  /** Whether to show the details/inspect button on each mint (default: true) */
  showDetailsButton?: boolean;
  /** Label for currency selector (default: "Currency") */
  currencyLabel?: string;
  /** Label for mints list (default: "Your mints") */
  mintsLabel?: string;
  /** Label for close/cancel button (default: "Close") */
  closeButtonLabel?: string;
  /** Called when a mint is selected */
  onMintSelect: (mint: Mint & { amount: number; unit: string }) => void | Promise<void>;
  /** Called when inspect/details button is pressed on a mint */
  onInspectMint?: (mintUrl: string) => void;
  /** Called when close/cancel button is pressed */
  onClose: () => void;
  /** Allowed currencies to filter by */
  allowedCurrencies?: string[];
  /** Allowed mint URLs to show (for payment requests with specified mints) */
  allowedMints?: string[];
}

export function MintListScreen({
  requireBalance = false,
  minAmount,
  showDetailsButton = true,
  currencyLabel: _currencyLabel = 'Currency',
  mintsLabel: _mintsLabel = 'Your mints',
  closeButtonLabel = 'Close',
  onMintSelect,
  onInspectMint,
  onClose,
  allowedCurrencies = ['SAT', 'USD', 'EUR', 'GBP'],
  allowedMints,
}: MintListScreenProps) {
  const { getPrimaryColor } = useTheme();

  // Scroll tracking for animated currency tabs
  const scrollY = useSharedValue(0);

  // Track header height from ModalLayoutWrapper
  const [totalHeaderHeight, setTotalHeaderHeight] = useState(0);

  // Use useMints() for live-updating trusted mints list (listens to mint:added/mint:updated events)
  const { trustedMints } = useMints();
  // Use useMintManagement() only for operations like getBalances
  const { getBalances } = useMintManagement();
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const setSelectedMint = useMintStore((state) => state.setSelectedMint);
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey;

  // Currency selection state
  const [selectedCurrency, setSelectedCurrency] = useState<string>('ALL');

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

  // Process mints with balances - use trustedMints from useMints() for live updates
  const processedMints = useMemo(() => {
    if (trustedMints.length === 0) return [];

    const mintsWithBalances = trustedMints.map((mint) => ({
      unit: 'SAT',
      amount: balances[mint.mintUrl] || 0,
      ...mint,
    }));

    return _.orderBy(mintsWithBalances, ['amount'], ['desc']);
  }, [trustedMints, balances]);

  // Extract available currencies from mints
  const availableCurrencies = useMemo(() => {
    const units: string[] = [];
    processedMints.forEach((mint) => {
      if (mint.mintInfo?.nuts?.['4']?.methods) {
        mint.mintInfo.nuts['4'].methods.forEach((method: any) => {
          if (method.unit) {
            units.push(method.unit.toUpperCase());
          }
        });
      } else {
        units.push('SAT');
      }
    });
    const uniqueUnits = [...new Set(units)];
    const filtered = uniqueUnits.filter((c) => allowedCurrencies.includes(c));
    return ['ALL', ...filtered];
  }, [processedMints, allowedCurrencies]);

  // Filter mints by selected currency (allowedMints and minAmount are handled by MintItem opacity/disabled)
  const filteredMints = useMemo(() => {
    let mints = processedMints;

    // Filter by currency only - allowedMints is handled by isAllowed prop on MintItem
    if (selectedCurrency !== 'ALL') {
      mints = mints.filter((mint) => {
        if (!mint.mintInfo?.nuts?.['4']?.methods) {
          return selectedCurrency === 'SAT';
        }
        return mint.mintInfo.nuts['4'].methods.some(
          (method: any) => method.unit?.toUpperCase() === selectedCurrency
        );
      });
    }

    // Sort: visible mints first (by balance desc), then non-visible mints (by balance desc)
    // A mint is "visible" (selectable) if:
    // 1. It's in allowedMints (or no allowedMints filter)
    // 2. Has sufficient balance for minAmount (or no minAmount filter)
    // 3. Has balance when requireBalance is true
    return mints.sort((a, b) => {
      const aAllowed =
        !allowedMints || allowedMints.length === 0 || allowedMints.includes(a.mintUrl);
      const bAllowed =
        !allowedMints || allowedMints.length === 0 || allowedMints.includes(b.mintUrl);
      const aHasSufficientBalance =
        minAmount === undefined || minAmount <= 0 || a.amount >= minAmount;
      const bHasSufficientBalance =
        minAmount === undefined || minAmount <= 0 || b.amount >= minAmount;
      const aHasRequiredBalance = !requireBalance || a.amount > 0;
      const bHasRequiredBalance = !requireBalance || b.amount > 0;

      const aVisible = aAllowed && aHasSufficientBalance && aHasRequiredBalance;
      const bVisible = bAllowed && bHasSufficientBalance && bHasRequiredBalance;

      // Visible mints come first
      if (aVisible && !bVisible) return -1;
      if (!aVisible && bVisible) return 1;

      // Within same visibility group, sort by balance descending
      return b.amount - a.amount;
    });
  }, [processedMints, selectedCurrency, allowedMints, minAmount, requireBalance]);

  // Helper to check if a mint is allowed (for payment requests with specified mints)
  const isMintAllowed = useCallback(
    (mintUrl: string) => {
      if (!allowedMints || allowedMints.length === 0) return true;
      return allowedMints.includes(mintUrl);
    },
    [allowedMints]
  );

  // Fetch KYM scores
  const mintUrls = useMemo(() => processedMints.map((mint) => mint.mintUrl), [processedMints]);
  const { scores: kymScores, loading: kymLoading } = useKYMMints(mintUrls);

  // Only lowercases the domain, preserves path case (e.g., /Bitcoin stays /Bitcoin)
  const normalizeUrl = useCallback((url: string): string => {
    const withoutProtocol = url.replace(/^https?:\/\//, '');
    const slashIndex = withoutProtocol.indexOf('/');
    if (slashIndex === -1) {
      // No path, just domain
      return withoutProtocol
        .toLowerCase()
        .replace(/^www\./, '')
        .replace(/\/$/, '');
    }
    const domain = withoutProtocol
      .slice(0, slashIndex)
      .toLowerCase()
      .replace(/^www\./, '');
    const path = withoutProtocol.slice(slashIndex).replace(/\/$/, '');
    return domain + path;
  }, []);

  // Handle currency change
  const handleCurrencyChange = useCallback((currency: string) => {
    setSelectedCurrency(currency);
  }, []);

  // Handle mint selection
  const handleMintSelect = useCallback(
    async (mintUrl: string) => {
      if (loadingId !== null) return;

      const mint = processedMints.find((m) => m.mintUrl === mintUrl);
      if (!mint) return;

      // Check if balance is required and mint has no balance
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

      // Check if mint has sufficient balance for minAmount
      if (minAmount !== undefined && minAmount > 0 && mint.amount < minAmount) {
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
        if (pubkey) {
          setSelectedMint(pubkey, mint.mintUrl);
        }
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
    [processedMints, pubkey, setSelectedMint, requireBalance, minAmount, onMintSelect, loadingId]
  );

  // Handle inspect mint
  const handleInspectMint = useCallback(
    (mintUrl: string) => {
      onInspectMint?.(mintUrl);
    },
    [onInspectMint]
  );

  // Memoize colors
  const primaryColor0 = useMemo(() => getPrimaryColor('0'), [getPrimaryColor]);

  // Sticky currency tabs component
  const currencyTabs = useMemo(
    () => (
      <MintCurrencyTabs
        currencies={availableCurrencies}
        selectedCurrency={selectedCurrency}
        onCurrencyChange={handleCurrencyChange}
        scrollY={scrollY}
      />
    ),
    [availableCurrencies, selectedCurrency, handleCurrencyChange, scrollY]
  );

  // Regular scroll handler for LegendList - updates scrollY for currency tab animations
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.value = Math.max(0, event.nativeEvent.contentOffset.y);
    },
    [scrollY]
  );

  // Render item for LegendList
  type MintWithBalance = Mint & { amount: number; unit: string };
  const renderItem = useCallback(
    ({ item }: { item: MintWithBalance }) => {
      const normalizedUrl = normalizeUrl(item.mintUrl);
      const kymData = kymScores[normalizedUrl];
      const kymScore = kymData?.score;

      return (
        <MintItem
          mint={item}
          balance={{ amount: item.amount, unit: item.unit }}
          isLoading={loadingId === item.mintUrl}
          globalLoading={loadingId !== null}
          requireBalance={requireBalance}
          minAmount={minAmount}
          showDetailsButton={showDetailsButton}
          onInspectPress={onInspectMint ? () => handleInspectMint(item.mintUrl) : undefined}
          selectedCurrency={selectedCurrency}
          kymScore={kymScore}
          kymLoading={kymLoading}
          isAllowed={isMintAllowed(item.mintUrl)}
          onPress={() => {
            handleMintSelect(item.mintUrl);
          }}
        />
      );
    },
    [
      normalizeUrl,
      kymScores,
      kymLoading,
      loadingId,
      requireBalance,
      minAmount,
      showDetailsButton,
      onInspectMint,
      handleInspectMint,
      selectedCurrency,
      isMintAllowed,
      handleMintSelect,
    ]
  );

  // List header spacer to push content below sticky header + currency tabs
  const listHeader = useMemo(
    () => <View style={{ height: totalHeaderHeight }} />,
    [totalHeaderHeight]
  );

  // Empty state component
  const emptyComponent = useMemo(
    () => (
      <Text style={{ color: opacity(primaryColor0, 0.66), textAlign: 'center', marginTop: 20 }}>
        {selectedCurrency === 'ALL'
          ? 'No mints available'
          : `No mints available for ${selectedCurrency === 'SAT' ? 'BTC' : selectedCurrency}`}
      </Text>
    ),
    [selectedCurrency, primaryColor0]
  );

  // Bottom buttons component
  const bottomButtons = useMemo(
    () => (
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
    ),
    [closeButtonLabel, onClose]
  );

  return (
    <ModalLayoutWrapper
      headerGradient
      stickyContent={currencyTabs}
      stickyContentHeight={CURRENCY_TABS_HEIGHT}
      useCustomScrollView
      onHeaderHeightChange={setTotalHeaderHeight}
      bottomContent={bottomButtons}>
      <LegendList
        data={filteredMints}
        renderItem={renderItem}
        keyExtractor={(item) => item.mintUrl}
        estimatedItemSize={120}
        drawDistance={300}
        style={{ flex: 1, height: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 120 }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={emptyComponent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />
    </ModalLayoutWrapper>
  );
}
