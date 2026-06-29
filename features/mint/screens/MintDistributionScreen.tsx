import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { z } from 'zod';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import {
  MintCurrencyTabs,
  MINT_CURRENCY_TABS_HEIGHT,
} from '@/features/mint/components/MintCurrencyTabs';
import { BALANCE_SPLIT_VARIANT_COMPONENTS } from '@/features/mint/components/distribution/variants';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { Screen } from '@/shared/ui/composed/Screen';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { useMints, useBalanceContext } from '@cashu/coco-react';
import { useMintManagement } from '@/features/mint/hooks/useMintManagement';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import {
  EMPTY_DISTRIBUTION,
  useMintDistributionStore,
  TOTAL_BASIS_POINTS,
} from '@/shared/stores/profile/mintDistributionStore';
import { log, useLifecycleLogger } from '@/shared/lib/logger';

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
  const [foreground, danger, muted] = useThemeColor(['foreground', 'danger', 'muted'] as const);
  const params = useRouteParams(ParamsSchema, { where: 'mint-flow.distribution' });
  const balanceSplitVariant = useSettingsStore((state) => state.balanceSplitVariant);
  const VariantBody = BALANCE_SPLIT_VARIANT_COMPONENTS[balanceSplitVariant];
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

  const totalBp = useMemo(() => {
    return mintUrls.reduce((sum, url) => sum + (distribution[url] || 0), 0);
  }, [mintUrls, distribution]);
  const isBalanced = totalBp === TOTAL_BASIS_POINTS;

  useEffect(() => {
    // `build` marker confirms which dismiss-fix revision is actually running on
    // device (fast-refresh vs stale build), so we stop guessing blind.
    log.debug('mint.balance_split.render', {
      variant: balanceSplitVariant,
      scrollMode: 'auto',
      build: 'dismiss-fix-3',
    });
  }, [balanceSplitVariant]);

  // The currency tabs are the only pinned chrome — a constant sticky height means
  // switching presentational variants never shifts the reserved scroll-top space.
  const stickyHeader = useMemo(
    () => (
      <MintCurrencyTabs
        currencies={availableCurrencies}
        selectedCurrency={selectedCurrency}
        onCurrencyChange={setSelectedCurrency}
      />
    ),
    [availableCurrencies, selectedCurrency]
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
            { text: 'Split evenly', variant: 'secondary', onPress: handleEqualize },
            { text: 'Next', variant: 'primary', onPress: handleRebalance },
          ]}
        />
      </BottomButtons>
    ),
    [handleEqualize, handleRebalance]
  );

  return (
    <Screen
      name="MintDistributionScreen"
      headerGradient
      stickyContent={stickyHeader}
      stickyContentHeight={MINT_CURRENCY_TABS_HEIGHT}
      // Plain ScrollView (NOT scroll="animated"): on Android the reanimated
      // Animated.ScrollView doesn't hand overscroll to the native form-sheet, so
      // drag-to-dismiss was dead here. The currency tabs lose their scroll-shrink
      // on this screen as the trade — keep it on the working dismiss path.
      scroll="auto"
      footer={bottomButtons}
      contentPadding={0}>
      <Stack.Screen options={withGlassHeaderItems({ title: 'Balance split' })} />

      {/* Ambient validity cue — the affirmative "100%", coloured only when off. */}
      <View className="items-end px-4 pb-1 pt-2">
        <Text bold size={13} style={{ color: isBalanced ? muted : danger }}>
          {Math.round(totalBp / 100)}%
        </Text>
      </View>

      {mintsForCurrency.length === 0 ? (
        <View className="items-center p-10">
          <Text style={{ color: foreground, textAlign: 'center' }}>
            No mints available for {selectedCurrency === 'SAT' ? 'BTC' : selectedCurrency}
          </Text>
        </View>
      ) : (
        <VariantBody
          mintUrls={mintUrls}
          mintInfoMap={mintInfoMap}
          distribution={distribution}
          balanceTotals={balanceTotals}
          unit={selectedCurrency.toLowerCase()}
          onDistributionChange={handleDistributionChange}
        />
      )}
    </Screen>
  );
}
