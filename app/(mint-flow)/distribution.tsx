/**
 * @fileoverview Balance Split Distribution Editor
 *
 * Modal screen for editing mint distribution percentages.
 * Uses basis points (10,000 = 100%) for precise integer math.
 *
 * Features:
 * - Unit selector tabs (BTC, USD, EUR, GBP)
 * - Per-mint sliders with percentage display
 * - Max/Min quick actions per mint
 * - Equalize button for even distribution among active mints
 * - Persists to Zustand store
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { StyleSheet, Alert } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSharedValue } from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { View } from 'components/ui/View/View';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon from 'assets/icons';
import { MintCurrencyTabs } from 'components/blocks/sheets/mint-balance/MintCurrencyTabs';
import { MintDistributionItem, DistributionBar } from 'components/blocks/distribution';
import { ModalLayoutWrapper } from 'app/debugModal';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { useMints, useBalanceContext } from 'coco-cashu-react';
import { useMintManagement } from '@/hooks/coco/useMintManagement';
import { useMintDistributionStore, TOTAL_BASIS_POINTS } from 'stores/mintDistributionStore';
import opacity from 'hex-color-opacity';

// Height constants
const DISTRIBUTION_BAR_HEIGHT = 48; // 32px bar + 16px margin
const CURRENCY_TABS_HEIGHT = 48;
const STICKY_CONTENT_HEIGHT = DISTRIBUTION_BAR_HEIGHT + CURRENCY_TABS_HEIGHT;

function DistributionScreen() {
  const { getPrimaryColor, getShadeColor } = useTheme();
  const primaryColor0 = useMemo(() => getPrimaryColor('0'), [getPrimaryColor]);
  const primaryColor950 = useMemo(() => getPrimaryColor('950'), [getPrimaryColor]);

  // Get params
  const params = useLocalSearchParams<{ unit?: string }>();

  // Scroll tracking for animated currency tabs
  const scrollY = useSharedValue(0);

  // Mint data
  const { trustedMints } = useMints();
  const { balance: liveBalances } = useBalanceContext();
  const { getMintInfo } = useMintManagement();

  // Mint info state
  const [mintInfoMap, setMintInfoMap] = useState<Record<string, any>>({});

  // Read initial unit from route params (e.g. { unit: 'usd' } from Wallet Health modal)
  const routeCurrency = useMemo(() => {
    const raw = params.unit;
    if (!raw) return null;
    const norm = String(raw).toLowerCase();
    // Treat btc as sats in the UI selector
    if (norm === 'btc' || norm === 'sat') return 'SAT';
    return norm.toUpperCase();
  }, [params.unit]);

  // Currency selection state
  const [selectedCurrency, setSelectedCurrency] = useState<string>('SAT');

  // Distribution store - subscribe to distributions for reactive updates
  const distributions = useMintDistributionStore((state) => state.distributions);
  const setMintDistribution = useMintDistributionStore((state) => state.setMintDistribution);
  const initializeDistribution = useMintDistributionStore((state) => state.initializeDistribution);
  const equalizeMints = useMintDistributionStore((state) => state.equalizeMints);
  const maxMint = useMintDistributionStore((state) => state.maxMint);
  const minMint = useMintDistributionStore((state) => state.minMint);

  // Get distribution for current currency (reactive to store changes)
  const distribution = useMemo(
    () => distributions[selectedCurrency.toLowerCase()] || {},
    [distributions, selectedCurrency]
  );

  // Extract available currencies from mints
  const availableCurrencies = useMemo(() => {
    const units: string[] = [];
    trustedMints.forEach((mint) => {
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
    // Filter to common currencies and ensure at least SAT
    const filtered = uniqueUnits.filter((c) => ['SAT', 'USD', 'EUR', 'GBP'].includes(c));
    return filtered.length > 0 ? filtered : ['SAT'];
  }, [trustedMints]);

  // Initialize selected currency from route param exactly once (if valid), otherwise keep default.
  useEffect(() => {
    if (!routeCurrency) return;
    if (!availableCurrencies.includes(routeCurrency)) return;
    // Only override if we're still at the default; don't clobber user-driven changes.
    setSelectedCurrency((prev) => (prev === 'SAT' ? routeCurrency : prev));
  }, [routeCurrency, availableCurrencies]);

  // Mints for the selected currency
  const mintsForCurrency = useMemo(() => {
    return trustedMints.filter((mint) => {
      if (selectedCurrency === 'SAT') {
        // Default to SAT if no nuts data
        if (!mint.mintInfo?.nuts?.['4']?.methods) return true;
        return mint.mintInfo.nuts['4'].methods.some(
          (method: any) => method.unit?.toUpperCase() === 'SAT'
        );
      }
      if (!mint.mintInfo?.nuts?.['4']?.methods) return false;
      return mint.mintInfo.nuts['4'].methods.some(
        (method: any) => method.unit?.toUpperCase() === selectedCurrency
      );
    });
  }, [trustedMints, selectedCurrency]);

  // Mint URLs for the selected currency
  const mintUrls = useMemo(() => mintsForCurrency.map((m) => m.mintUrl), [mintsForCurrency]);

  // Initialize distribution when mints or currency change
  useEffect(() => {
    if (mintUrls.length > 0) {
      initializeDistribution(selectedCurrency, mintUrls);
    }
  }, [selectedCurrency, mintUrls, initializeDistribution]);

  // Load mint info for all mints
  useEffect(() => {
    const loadMintInfo = async () => {
      const infoMap: Record<string, any> = {};
      for (const mint of trustedMints) {
        try {
          const info = await getMintInfo(mint.mintUrl);
          infoMap[mint.mintUrl] = info;
        } catch {
          // Use mint's stored info as fallback
          infoMap[mint.mintUrl] = mint.mintInfo || null;
        }
      }
      setMintInfoMap(infoMap);
    };
    loadMintInfo();
  }, [trustedMints, getMintInfo]);

  // Handle currency change
  const handleCurrencyChange = useCallback((currency: string) => {
    setSelectedCurrency(currency);
  }, []);

  // Handle distribution change from slider
  const handleDistributionChange = useCallback(
    (mintUrl: string, bp: number) => {
      setMintDistribution(selectedCurrency, mintUrl, bp, mintUrls);
    },
    [selectedCurrency, mintUrls, setMintDistribution]
  );

  // Handle Max button
  const handleMax = useCallback(
    (mintUrl: string) => {
      maxMint(selectedCurrency, mintUrl, mintUrls);
    },
    [selectedCurrency, mintUrls, maxMint]
  );

  // Handle Min button
  const handleMin = useCallback(
    (mintUrl: string) => {
      minMint(selectedCurrency, mintUrl, mintUrls);
    },
    [selectedCurrency, mintUrls, minMint]
  );

  // Handle Equalize button
  const handleEqualize = useCallback(() => {
    equalizeMints(selectedCurrency, mintUrls);
  }, [selectedCurrency, mintUrls, equalizeMints]);

  // Check if there are active mints (bp > 0)
  const hasActiveMints = useMemo(() => {
    return mintUrls.some((url) => (distribution[url] || 0) > 0);
  }, [mintUrls, distribution]);

  // Verify total is 10,000
  const totalBp = useMemo(() => {
    return mintUrls.reduce((sum, url) => sum + (distribution[url] || 0), 0);
  }, [mintUrls, distribution]);

  // Sticky header content (distribution bar + currency tabs)
  const stickyHeader = useMemo(
    () => (
      <View>
        {/* Distribution overview bar */}
        <DistributionBar
          distribution={distribution}
          mintInfoMap={mintInfoMap}
          mintUrls={mintUrls}
        />
        {/* Currency tabs */}
        <MintCurrencyTabs
          currencies={availableCurrencies}
          selectedCurrency={selectedCurrency}
          onCurrencyChange={handleCurrencyChange}
          scrollY={scrollY}
        />
      </View>
    ),
    [
      distribution,
      mintInfoMap,
      mintUrls,
      availableCurrencies,
      selectedCurrency,
      handleCurrencyChange,
      scrollY,
    ]
  );

  // Handle navigating to rebalance plan
  const handleRebalance = useCallback(() => {
    router.navigate({
      pathname: '/rebalancePlan',
      params: { unit: selectedCurrency },
    });
  }, [selectedCurrency]);

  // Bottom buttons
  const bottomButtons = useMemo(
    () => (
      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: 'Equalize',
              variant: 'secondary' as const,
              onPress: async () => handleEqualize(),
            },
            {
              text: 'Rebalance',
              variant: 'primary' as const,
              onPress: async () => handleRebalance(),
            },
          ]}
        />
      </BottomButtons>
    ),
    [handleEqualize, handleRebalance]
  );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: primaryColor950 }}>
      <Stack.Screen
        options={{
          title: 'Balance split',
          headerRight: () => (
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  'Balance Split',
                  'Set how new funds should be distributed across your mints. ' +
                    'When you receive ecash, it will follow this split.\n\n' +
                    '• Max: Set a mint to 100%\n' +
                    '• Min: Set a mint to 0%\n' +
                    '• Equalize: Distribute evenly among active mints',
                  [{ text: 'Got it' }]
                );
              }}
              style={{ padding: 8 }}>
              <Icon name="mdi:help-circle" size={24} color={primaryColor0} />
            </TouchableOpacity>
          ),
        }}
      />

      <ModalLayoutWrapper
        headerGradient
        stickyContent={stickyHeader}
        stickyContentHeight={STICKY_CONTENT_HEIGHT}
        useAnimatedScroll
        scrollY={scrollY}
        bottomContent={bottomButtons}
        contentPadding={0}>
        {/* Distribution summary */}
        <View style={styles.summaryContainer}>
          <HStack justify="space-between" align="center" style={{ paddingHorizontal: 16 }}>
            <Text size={14} style={{ color: opacity(getPrimaryColor('0'), 0.5) }}>
              Total distribution
            </Text>
            <Text
              bold
              overpass
              size={14}
              style={{
                color: totalBp === TOTAL_BASIS_POINTS ? getPrimaryColor('0') : getShadeColor('300'),
              }}>
              {(totalBp / 100).toFixed(1)}%{totalBp !== TOTAL_BASIS_POINTS && ' ⚠️'}
            </Text>
          </HStack>
        </View>

        {/* Mints list */}
        {mintsForCurrency.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={{ color: primaryColor0, textAlign: 'center' }}>
              No mints available for {selectedCurrency === 'SAT' ? 'BTC' : selectedCurrency}
            </Text>
          </View>
        ) : (
          <VStack gap={4}>
            {mintsForCurrency.map((mint) => (
              <MintDistributionItem
                key={mint.mintUrl}
                mintUrl={mint.mintUrl}
                mintInfo={mintInfoMap[mint.mintUrl]}
                balance={liveBalances[mint.mintUrl] || 0}
                unit={selectedCurrency.toLowerCase()}
                distributionBp={distribution[mint.mintUrl] || 0}
                onDistributionChange={handleDistributionChange}
                onMax={handleMax}
                onMin={handleMin}
              />
            ))}
          </VStack>
        )}

        {/* Info text */}
        <View style={styles.infoContainer}>
          <Text
            size={12}
            style={{ color: opacity(getPrimaryColor('0'), 0.4), textAlign: 'center' }}>
            {hasActiveMints
              ? 'Adjusting one mint redistributes among active mints only'
              : 'Tap Equalize to distribute evenly across all mints'}
          </Text>
        </View>
      </ModalLayoutWrapper>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  summaryContainer: {
    paddingVertical: 6,
    marginBottom: 4,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  infoContainer: {
    padding: 16,
    marginTop: 8,
  },
});

export default withSheetProvider(DistributionScreen);
