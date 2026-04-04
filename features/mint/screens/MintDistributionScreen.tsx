import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Alert } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSharedValue } from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import Icon from 'assets/icons';
import { MintCurrencyTabs } from '@/features/mint/components/MintCurrencyTabs';
import { MintDistributionItem, DistributionBar } from '@/features/mint/components/distribution';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { useMints, useBalanceContext } from '@cashu/coco-react';
import { useMintManagement } from '@/features/mint/hooks/useMintManagement';
import {
  useMintDistributionStore,
  TOTAL_BASIS_POINTS,
} from '@/shared/stores/profile/mintDistributionStore';
import opacity from 'hex-color-opacity';
import { log, useLifecycleLogger, Screen } from '@/shared/lib/logger';

const DISTRIBUTION_BAR_HEIGHT = 48;
const CURRENCY_TABS_HEIGHT = 48;
const STICKY_CONTENT_HEIGHT = DISTRIBUTION_BAR_HEIGHT + CURRENCY_TABS_HEIGHT;

export function MintDistributionScreen() {
  useLifecycleLogger('MintDistributionScreen');
  const [foreground, background, danger] = useThemeColor([
    'foreground',
    'background',
    'danger',
  ] as const);
  const params = useLocalSearchParams<{ unit?: string }>();
  const scrollY = useSharedValue(0);
  const { trustedMints } = useMints();
  const { balance: liveBalances } = useBalanceContext();
  const { getMintInfo } = useMintManagement();
  const [mintInfoMap, setMintInfoMap] = useState<Record<string, any>>({});

  const routeCurrency = useMemo(() => {
    const raw = params.unit;
    if (!raw) return null;
    const norm = String(raw).toLowerCase();
    // Treat btc as sats in the UI selector
    if (norm === 'btc' || norm === 'sat') return 'SAT';
    return norm.toUpperCase();
  }, [params.unit]);

  const [selectedCurrency, setSelectedCurrency] = useState<string>('SAT');

  const distributions = useMintDistributionStore((state) => state.distributions);
  const setMintDistribution = useMintDistributionStore((state) => state.setMintDistribution);
  const initializeDistribution = useMintDistributionStore((state) => state.initializeDistribution);
  const equalizeMints = useMintDistributionStore((state) => state.equalizeMints);
  const maxMint = useMintDistributionStore((state) => state.maxMint);
  const minMint = useMintDistributionStore((state) => state.minMint);

  const distribution = useMemo(
    () => distributions[selectedCurrency.toLowerCase()] || {},
    [distributions, selectedCurrency]
  );

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

  useEffect(() => {
    if (!routeCurrency) return;
    if (!availableCurrencies.includes(routeCurrency)) return;
    // Only override if we're still at the default; don't clobber user-driven changes.
    setSelectedCurrency((prev) => (prev === 'SAT' ? routeCurrency : prev));
  }, [routeCurrency, availableCurrencies]);

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

  const mintUrls = useMemo(() => mintsForCurrency.map((m) => m.mintUrl), [mintsForCurrency]);

  useEffect(() => {
    if (mintUrls.length > 0) {
      initializeDistribution(selectedCurrency, mintUrls);
    }
  }, [selectedCurrency, mintUrls, initializeDistribution]);

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

  const handleDistributionChange = useCallback(
    (mintUrl: string, bp: number) => {
      log.debug('mint.distribution.change', { mintUrl, basisPoints: bp, currency: selectedCurrency });
      setMintDistribution(selectedCurrency, mintUrl, bp, mintUrls);
    },
    [selectedCurrency, mintUrls, setMintDistribution]
  );

  const handleMax = useCallback(
    (mintUrl: string) => {
      maxMint(selectedCurrency, mintUrl, mintUrls);
    },
    [selectedCurrency, mintUrls, maxMint]
  );

  const handleMin = useCallback(
    (mintUrl: string) => {
      minMint(selectedCurrency, mintUrl, mintUrls);
    },
    [selectedCurrency, mintUrls, minMint]
  );

  const handleEqualize = useCallback(() => {
    log.info('mint.distribution.equalize', { currency: selectedCurrency, mintCount: mintUrls.length });
    equalizeMints(selectedCurrency, mintUrls);
  }, [selectedCurrency, mintUrls, equalizeMints]);

  const hasActiveMints = useMemo(() => {
    return mintUrls.some((url) => (distribution[url] || 0) > 0);
  }, [mintUrls, distribution]);

  const totalBp = useMemo(() => {
    return mintUrls.reduce((sum, url) => sum + (distribution[url] || 0), 0);
  }, [mintUrls, distribution]);

  const stickyHeader = useMemo(
    () => (
      <View>
        <DistributionBar
          distribution={distribution}
          mintInfoMap={mintInfoMap}
          mintUrls={mintUrls}
        />
        <MintCurrencyTabs
          currencies={availableCurrencies}
          selectedCurrency={selectedCurrency}
          onCurrencyChange={setSelectedCurrency}
          scrollY={scrollY}
        />
      </View>
    ),
    [distribution, mintInfoMap, mintUrls, availableCurrencies, selectedCurrency, scrollY]
  );

  const handleRebalance = useCallback(() => {
    log.info('mint.distribution.rebalance', { currency: selectedCurrency });
    router.navigate({
      pathname: '/rebalancePlan',
      params: { unit: selectedCurrency },
    });
  }, [selectedCurrency]);

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
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: background }}>
      <Screen name="MintDistributionScreen">
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
              className="p-2">
              <Icon name="mdi:help-circle" size={24} color={foreground} />
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
        <View className="mb-1 py-1.5">
          <HStack justify="space-between" align="center" className="px-4">
            <Text size={14} style={{ color: opacity(foreground, 0.5) }}>
              Total distribution
            </Text>
            <Text
              bold
              size={14}
              style={{
                color: totalBp === TOTAL_BASIS_POINTS ? foreground : danger,
              }}>
              {(totalBp / 100).toFixed(1)}%{totalBp !== TOTAL_BASIS_POINTS && ' ⚠️'}
            </Text>
          </HStack>
        </View>

        {mintsForCurrency.length === 0 ? (
          <View className="items-center p-10">
            <Text style={{ color: foreground, textAlign: 'center' }}>
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

        <View className="mt-2 p-4">
          <Text size={12} style={{ color: opacity(foreground, 0.4), textAlign: 'center' }}>
            {hasActiveMints
              ? 'Adjusting one mint redistributes among active mints only'
              : 'Tap Equalize to distribute evenly across all mints'}
          </Text>
        </View>
      </ModalLayoutWrapper>
      </Screen>
    </GestureHandlerRootView>
  );
}
