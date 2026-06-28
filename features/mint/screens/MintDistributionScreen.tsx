import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useSharedValue } from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { z } from 'zod';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Button } from '@/shared/ui/primitives/Button';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import {
  MintCurrencyTabs,
  MINT_CURRENCY_TABS_HEIGHT,
} from '@/features/mint/components/MintCurrencyTabs';
import { MintDistributionItem, DistributionBar } from '@/features/mint/components/distribution';
import { Screen } from '@/shared/ui/composed/Screen';
import { Card } from '@/shared/ui/composed/Card';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { useMints, useBalanceContext } from '@cashu/coco-react';
import { useMintManagement } from '@/features/mint/hooks/useMintManagement';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import {
  EMPTY_DISTRIBUTION,
  useMintDistributionStore,
  TOTAL_BASIS_POINTS,
} from '@/shared/stores/profile/mintDistributionStore';
import opacity from 'hex-color-opacity';
import { log, useLifecycleLogger } from '@/shared/lib/logger';

const DISTRIBUTION_BAR_HEIGHT = 48;
const STICKY_CONTENT_HEIGHT = DISTRIBUTION_BAR_HEIGHT + MINT_CURRENCY_TABS_HEIGHT;

const ParamsSchema = z.object({
  unit: z.string().max(16).optional(),
});

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

export function MintDistributionScreen() {
  useLifecycleLogger('MintDistributionScreen');
  const [foreground, background, danger] = useThemeColor([
    'foreground',
    'background',
    'danger',
  ] as const);
  const params = useRouteParams(ParamsSchema, { where: 'mint-flow.distribution' });
  const scrollY = useSharedValue(0);
  const { trustedMints } = useMints();
  const { balances: liveBalanceCtx } = useBalanceContext();
  const liveBalances = liveBalanceCtx.byMint;
  const { getMintInfo } = useMintManagement();
  const [mintInfoMap, setMintInfoMap] = useState<Record<string, any>>({});

  const routeCurrency = useMemo(() => {
    const raw = params?.unit;
    if (!raw) return null;
    const norm = raw.toLowerCase();
    // Treat btc as sats in the UI selector
    if (norm === 'btc' || norm === 'sat') return 'SAT';
    return norm.toUpperCase();
  }, [params?.unit]);

  const [selectedCurrency, setSelectedCurrency] = useState<string>('SAT');

  // Narrow the selector to the per-unit slice. Returning the whole `distributions`
  // record made any write to any unit re-render this screen even though only the
  // selected currency's slice is read.
  const distribution = useMintDistributionStore(
    (state) => state.distributions[selectedCurrency.toLowerCase()] ?? EMPTY_DISTRIBUTION
  );
  const setMintDistribution = useMintDistributionStore((state) => state.setMintDistribution);
  const initializeDistribution = useMintDistributionStore((state) => state.initializeDistribution);
  const equalizeMints = useMintDistributionStore((state) => state.equalizeMints);
  const maxMint = useMintDistributionStore((state) => state.maxMint);
  const minMint = useMintDistributionStore((state) => state.minMint);
  const mirrorBalances = useMintDistributionStore((state) => state.mirrorBalances);
  const concentrateOnPrimary = useMintDistributionStore((state) => state.concentrateOnPrimary);

  const availableCurrencies = useMemo(() => {
    const units: string[] = [];
    trustedMints.forEach((mint) => {
      if (mint.mintInfo?.nuts?.['4']?.methods) {
        mint.mintInfo.nuts['4'].methods.forEach((method) => {
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
          (method) => method.unit?.toUpperCase() === 'SAT'
        );
      }
      if (!mint.mintInfo?.nuts?.['4']?.methods) return false;
      return mint.mintInfo.nuts['4'].methods.some(
        (method) => method.unit?.toUpperCase() === selectedCurrency
      );
    });
  }, [trustedMints, selectedCurrency]);

  const mintUrls = useMemo(() => mintsForCurrency.map((m) => m.mintUrl), [mintsForCurrency]);

  useEffect(() => {
    if (mintUrls.length > 0) {
      initializeDistribution(selectedCurrency, mintUrls);
    }
  }, [selectedCurrency, mintUrls, initializeDistribution]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const loadMintInfo = async () => {
      const settled = await Promise.allSettled(
        trustedMints.map((mint) => getMintInfo(mint.mintUrl))
      );
      if (!mountedRef.current) return;
      const infoMap: Record<string, any> = {};
      trustedMints.forEach((mint, i) => {
        const r = settled[i];
        infoMap[mint.mintUrl] = r && r.status === 'fulfilled' ? r.value : mint.mintInfo || null;
      });
      setMintInfoMap(infoMap);
    };
    void loadMintInfo();
  }, [trustedMints, getMintInfo]);

  const handleDistributionChange = useCallback(
    (mintUrl: string, bp: number) => {
      log.debug('mint.distribution.change', {
        ...mintUrlLogFields(mintUrl),
        basisPoints: bp,
        currency: selectedCurrency,
      });
      setMintDistribution(selectedCurrency, mintUrl, bp, mintUrls);
    },
    [selectedCurrency, mintUrls, setMintDistribution]
  );

  const handleMax = useCallback(
    (mintUrl: string) => {
      log.info('mint.distribution.max', {
        ...mintUrlLogFields(mintUrl),
        currency: selectedCurrency,
        mintCount: mintUrls.length,
      });
      maxMint(selectedCurrency, mintUrl, mintUrls);
    },
    [selectedCurrency, mintUrls, maxMint]
  );

  const handleMin = useCallback(
    (mintUrl: string) => {
      log.info('mint.distribution.min', {
        ...mintUrlLogFields(mintUrl),
        currency: selectedCurrency,
        mintCount: mintUrls.length,
      });
      minMint(selectedCurrency, mintUrl, mintUrls);
    },
    [selectedCurrency, mintUrls, minMint]
  );

  const handleEqualize = useCallback(() => {
    log.info('mint.distribution.equalize', {
      currency: selectedCurrency,
      mintCount: mintUrls.length,
    });
    equalizeMints(selectedCurrency, mintUrls);
  }, [selectedCurrency, mintUrls, equalizeMints]);

  const balanceTotals = useMemo(() => {
    const map: Record<string, number> = {};
    mintUrls.forEach((url) => {
      map[url] = amountToNumber(liveBalances[url]?.total);
    });
    return map;
  }, [mintUrls, liveBalances]);

  const handleMirror = useCallback(() => {
    log.info('mint.distribution.mirror', {
      currency: selectedCurrency,
      mintCount: mintUrls.length,
    });
    mirrorBalances(selectedCurrency, balanceTotals, mintUrls);
  }, [selectedCurrency, mintUrls, balanceTotals, mirrorBalances]);

  const handleConcentrate = useCallback(() => {
    log.info('mint.distribution.concentrate', {
      currency: selectedCurrency,
      mintCount: mintUrls.length,
    });
    concentrateOnPrimary(selectedCurrency, balanceTotals, mintUrls);
  }, [selectedCurrency, mintUrls, balanceTotals, concentrateOnPrimary]);

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

  const canConcentrate = mintUrls.length > 1;

  const bottomButtons = useMemo(
    () => (
      <BottomButtons>
        <HStack justify="space-around" align="flex-start" className="mb-3 px-8">
          <CircleActionButton
            icon="mdi:equal"
            systemIcon="equal.circle.fill"
            label="Split"
            onPress={handleEqualize}
            accessibilityHint="Distribute evenly across active mints"
            testID="mint-dist-equalize"
          />
          <CircleActionButton
            icon="mdi:restore"
            systemIcon="arrow.counterclockwise"
            label="Reset"
            onPress={handleMirror}
            accessibilityHint="Reset shares to match current balances"
            testID="mint-dist-mirror"
          />
          <CircleActionButton
            icon="mdi:target"
            systemIcon="target"
            label="Focus"
            onPress={handleConcentrate}
            disabled={!canConcentrate}
            accessibilityHint="Concentrate share on the top-balance mint"
            testID="mint-dist-concentrate"
          />
        </HStack>
        <View className="px-4">
          <Button text="Next" variant="primary" onPress={handleRebalance} />
        </View>
      </BottomButtons>
    ),
    [handleEqualize, handleMirror, handleConcentrate, handleRebalance, canConcentrate]
  );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: background }}>
      <Screen
        name="MintDistributionScreen"
        headerGradient
        stickyContent={stickyHeader}
        stickyContentHeight={STICKY_CONTENT_HEIGHT}
        scroll="animated"
        scrollY={scrollY}
        footer={bottomButtons}
        contentPadding={0}>
        <Stack.Screen
          options={withGlassHeaderItems({
            title: 'Balance split',
            headerRight: () => (
              <ScreenHeaderAction
                icon="mdi:help-circle"
                accessibilityLabel="Balance split help"
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
              />
            ),
          })}
        />
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
                balance={amountToNumber(liveBalances[mint.mintUrl]?.total)}
                unit={selectedCurrency.toLowerCase()}
                distributionBp={distribution[mint.mintUrl] || 0}
                onDistributionChange={handleDistributionChange}
                onMax={handleMax}
                onMin={handleMin}
              />
            ))}
          </VStack>
        )}

        <View className="mx-4 mt-2">
          <Card
            variant="info"
            message={
              hasActiveMints
                ? 'When you change one mint, only mints already above 0% rebalance to keep the total at 100%. Mints at 0% stay at 0%.'
                : 'Tap Equalize to distribute evenly across all mints.'
            }
          />
        </View>
      </Screen>
    </GestureHandlerRootView>
  );
}
