import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  LayoutAnimation,
  ScrollView,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { z } from 'zod';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { ListGroup, Switch as HeroSwitch } from 'heroui-native';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import {
  MintCurrencyTabs,
  MINT_CURRENCY_TABS_HEIGHT,
} from '@/features/mint/components/MintCurrencyTabs';
import { useMintKeysetUnits } from '@/features/wallet/hooks/useMintKeysetUnits';
import { deriveSupportedUnitsFromInfo } from 'wallet';
import { MintDistributionCards } from '@/features/mint/components/distribution/MintDistributionCards';
import { Screen } from '@/shared/ui/composed/Screen';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { useMints } from '@cashu/coco-react';
import { useMintManagement } from '@/features/mint/hooks/useMintManagement';
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

/**
 * Every commit redistributes the OTHER mints' shares in one store write, which
 * would snap their fills/thumbs to the new positions. The heroui Slider lays
 * out fill/thumb with plain `left`/`width`, so a layout animation on the commit
 * springs all sliders (and the collapsing slider row on toggle) together —
 * mirroring the old DistributionSlider's withSpring fill. Drag frames stay
 * un-animated: they go through the card's local preview state, not the store.
 */
function animateRedistribution() {
  LayoutAnimation.configureNext({
    duration: 350,
    update: { type: LayoutAnimation.Types.spring, springDamping: 0.85 },
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
    delete: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
  });
}

/**
 * "Even" as `equalizeMints` produces it: every active mint within 1bp of the
 * others (floor + largest-remainder spread). Used to seed the Split evenly
 * switch from the persisted distribution.
 */
function isEvenSplit(distribution: Record<string, number>, mintUrls: string[]): boolean {
  const active = mintUrls.map((url) => distribution[url] || 0).filter((bp) => bp > 0);
  if (active.length === 0) return false;
  return Math.max(...active) - Math.min(...active) <= 1;
}

export function MintDistributionScreen() {
  useLifecycleLogger('MintDistributionScreen');
  const [foreground] = useThemeColor(['foreground'] as const);
  const params = useRouteParams(ParamsSchema, { where: 'mint-flow.distribution' });
  const { trustedMints } = useMints();
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
  const minMint = useMintDistributionStore((state) => state.minMint);

  // Keyset-backed: an advertised NUT-04 unit the mint holds no keys for
  // (chorus lists usd/eur with sat-only keysets) is not distributable.
  const keysetUnitsByMint = useMintKeysetUnits();
  const supportedUnitsByMint = useMemo(
    () =>
      Object.fromEntries(
        trustedMints.map((mint) => [
          mint.mintUrl,
          mint.mintInfo
            ? deriveSupportedUnitsFromInfo(mint.mintInfo, keysetUnitsByMint[mint.mintUrl])
            : ['sat'],
        ])
      ) as Record<string, string[]>,
    [trustedMints, keysetUnitsByMint]
  );

  const availableCurrencies = useMemo(() => {
    const units = new Set<string>();
    for (const supported of Object.values(supportedUnitsByMint)) {
      for (const unit of supported) units.add(unit.toUpperCase());
    }
    // Filter to common currencies and ensure at least SAT
    const filtered = [...units].filter((c) => ['SAT', 'USD', 'EUR', 'GBP'].includes(c));
    return filtered.length > 0 ? filtered : ['SAT'];
  }, [supportedUnitsByMint]);

  useEffect(() => {
    if (!routeCurrency) return;
    if (!availableCurrencies.includes(routeCurrency)) return;
    // Only override if we're still at the default; don't clobber user-driven changes.
    setSelectedCurrency((prev) => (prev === 'SAT' ? routeCurrency : prev));
  }, [routeCurrency, availableCurrencies]);

  const mintsForCurrency = useMemo(() => {
    return trustedMints.filter((mint) =>
      (supportedUnitsByMint[mint.mintUrl] ?? ['sat']).some(
        (unit) => unit.toUpperCase() === selectedCurrency
      )
    );
  }, [trustedMints, selectedCurrency, supportedUnitsByMint]);

  const mintUrls = useMemo(() => mintsForCurrency.map((m) => m.mintUrl), [mintsForCurrency]);

  useEffect(() => {
    if (mintUrls.length > 0) {
      initializeDistribution(selectedCurrency, mintUrls);
    }
  }, [selectedCurrency, mintUrls, initializeDistribution]);

  // "Split evenly" mode: ON keeps every enabled mint at an equal share (the
  // sliders are read-only), OFF frees the sliders for a custom split. Not
  // persisted — seeded per currency from whether the stored split is already
  // even. Reads the store imperatively: this runs in the same effect flush as
  // initializeDistribution above (declared later → runs after), so the
  // subscribed `distribution` snapshot can be one commit stale here.
  const [splitEvenly, setSplitEvenly] = useState(false);
  const seededSplitEvenlyFor = useRef<string | null>(null);
  useEffect(() => {
    if (mintUrls.length === 0) return;
    if (seededSplitEvenlyFor.current === selectedCurrency) return;
    seededSplitEvenlyFor.current = selectedCurrency;
    const stored = useMintDistributionStore.getState().getDistribution(selectedCurrency);
    setSplitEvenly(isEvenSplit(stored, mintUrls));
  }, [selectedCurrency, mintUrls]);

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
      animateRedistribution();
      setMintDistribution(selectedCurrency, mintUrl, bp, mintUrls);
    },
    [selectedCurrency, mintUrls, setMintDistribution]
  );

  const handleSplitEvenlyToggle = useCallback(
    (next: boolean) => {
      log.info('mint.distribution.split_evenly.toggle', {
        enabled: next,
        currency: selectedCurrency,
        mintCount: mintUrls.length,
      });
      if (next) {
        animateRedistribution();
        equalizeMints(selectedCurrency, mintUrls);
      }
      // Turning OFF keeps the current (even) values — it just frees the sliders.
      setSplitEvenly(next);
    },
    [selectedCurrency, mintUrls, equalizeMints]
  );

  const handleToggleMint = useCallback(
    (mintUrl: string, enabled: boolean) => {
      log.info('mint.distribution.toggle', {
        ...mintUrlLogFields(mintUrl),
        enabled,
        currency: selectedCurrency,
        splitEvenly,
      });
      animateRedistribution();
      if (enabled) {
        // Re-enable with an even share; the store takes it from the active
        // mints proportionally.
        setMintDistribution(
          selectedCurrency,
          mintUrl,
          Math.round(TOTAL_BASIS_POINTS / mintUrls.length),
          mintUrls
        );
      } else {
        minMint(selectedCurrency, mintUrl, mintUrls);
      }
      // In Split evenly mode the membership change must land exactly even —
      // the proportional redistribution above only gets within rounding drift.
      // Both writes batch into the same commit, so one animation runs.
      if (splitEvenly) {
        equalizeMints(selectedCurrency, mintUrls);
      }
    },
    [selectedCurrency, mintUrls, setMintDistribution, minMint, splitEvenly, equalizeMints]
  );

  useEffect(() => {
    // `build` marker confirms which revision is actually running on device
    // (fast-refresh vs stale build), so we stop guessing blind.
    log.debug('mint.balance_split.render', {
      scrollMode: 'custom-sticky',
      build: 'routing-cards-4-evenswitch',
    });
  }, []);

  // Sticky currency header, mirroring MintListScreen (the mint selector): tabs
  // pinned as Screen stickyContent, scrollY-driven large→small shrink, and a
  // custom plain ScrollView that reserves the nav+tabs band via a spacer from
  // onHeaderHeightChange. nestedScrollEnabled keeps the Android form-sheet's
  // drag-to-dismiss working (the sheet reads this scroller's overscroll) — the
  // earlier in-body fallback predates the mint-list sticky pattern.
  const scrollY = useSharedValue(0);
  const [totalHeaderHeight, setTotalHeaderHeight] = useState(0);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.value = Math.max(0, event.nativeEvent.contentOffset.y);
    },
    [scrollY]
  );

  const currencyTabs = useMemo(
    () => (
      <MintCurrencyTabs
        currencies={availableCurrencies}
        selectedCurrency={selectedCurrency}
        onCurrencyChange={setSelectedCurrency}
        scrollY={scrollY}
      />
    ),
    [availableCurrencies, selectedCurrency, scrollY]
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
              text: 'Next',
              variant: 'primary',
              testID: 'mint-distribution-next',
              onPress: handleRebalance,
            },
          ]}
        />
      </BottomButtons>
    ),
    [handleRebalance]
  );

  return (
    <Screen
      name="MintDistributionScreen"
      headerGradient
      stickyContent={currencyTabs}
      stickyContentHeight={MINT_CURRENCY_TABS_HEIGHT}
      scroll="custom"
      onHeaderHeightChange={setTotalHeaderHeight}
      footer={bottomButtons}>
      <Stack.Screen options={withGlassHeaderItems({ title: 'Balance split' })} />
      <ScrollView
        // The JS spacer below is the sole inset authority (same as the mint
        // list); `never` keeps iOS from re-adjusting it natively.
        contentInsetAdjustmentBehavior="never"
        // Android form-sheet: scroll the content instead of dismissing when
        // dragging back toward the top; overscroll at rest still dismisses.
        nestedScrollEnabled
        onScroll={handleScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
        contentContainerClassName="pb-30">
        <View style={{ height: totalHeaderHeight }} />

        {mintsForCurrency.length === 0 ? (
          <View className="items-center p-10">
            <Text style={{ color: foreground, textAlign: 'center' }}>
              No mints available for {selectedCurrency === 'SAT' ? 'BTC' : selectedCurrency}
            </Text>
          </View>
        ) : (
          <>
            <View className="px-4 pb-3 pt-2">
              <ListGroup variant="secondary">
                <ListGroup.Item>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>Split evenly</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>
                      Keep every enabled mint at an equal share.
                    </ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <HeroSwitch
                      isSelected={splitEvenly}
                      onSelectedChange={handleSplitEvenlyToggle}
                      aria-label="Split evenly"
                      testID="mint-distribution-split-evenly"
                    />
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              </ListGroup>
            </View>

            <MintDistributionCards
              mintUrls={mintUrls}
              mintInfoMap={mintInfoMap}
              distribution={distribution}
              slidersDisabled={splitEvenly}
              onDistributionChange={handleDistributionChange}
              onToggleMint={handleToggleMint}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
