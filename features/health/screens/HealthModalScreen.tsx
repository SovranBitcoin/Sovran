import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View as RNView } from 'react-native';
import { Stack } from 'expo-router';
import { z } from 'zod';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSharedValue } from 'react-native-reanimated';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { Screen } from '@/shared/ui/composed/Screen';
import { WalletHealthModalContent } from '@/features/health/components/WalletHealthModalContent';
import type { HealthCta } from '@/features/health/lib/walletHealth';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useHeroTransition } from '@/shared/providers/hero-transition/HeroTransitionProvider';
import { useMints } from '@cashu/coco-react';
import { log, useLifecycleLogger } from '@/shared/lib/logger';

const DEFAULT_CURRENCIES = ['SAT'];
const HEADER_OVERLAP = 24;

// `unit` is non-critical UX state — coerce any out-of-allowlist value back
// to `'sat'` rather than closing the modal, so a malformed deep link still
// shows the wallet-health view in the canonical unit.
const ParamsSchema = z.object({
  unit: z.enum(['sat', 'usd', 'eur', 'gbp', 'btc']).catch('sat').optional(),
});

function getCurrenciesFromMints(trustedMints: any[]): string[] {
  const units: string[] = [];
  for (const mint of trustedMints) {
    if (mint.mintInfo?.nuts?.['4']?.methods) {
      for (const method of mint.mintInfo.nuts['4'].methods) {
        if (method.unit) units.push(String(method.unit).toUpperCase());
      }
    } else {
      units.push('SAT');
    }
  }
  const unique = [...new Set(units)];
  const allowed = ['SAT', 'USD', 'EUR', 'GBP'];
  return unique.filter((u) => allowed.includes(u));
}

export function HealthModalScreen() {
  useLifecycleLogger('HealthModalScreen');
  const params = useRouteParams(ParamsSchema, { where: 'app.healthModal' });
  const initialUnit = params?.unit ?? 'sat';

  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const hero = useHeroTransition();
  const insets = useSafeAreaInsets();
  const nativeHeaderHeight = useHeaderHeight();
  const { trustedMints } = useMints();

  const currencies = useMemo(() => getCurrenciesFromMints(trustedMints), [trustedMints]);
  const [selectedCurrency, setSelectedCurrency] = useState<string>(
    initialUnit.toUpperCase() === 'BTC' ? 'SAT' : initialUnit.toUpperCase()
  );
  const availableCurrencies = currencies.length > 0 ? currencies : DEFAULT_CURRENCIES;
  const unit = selectedCurrency.toLowerCase() === 'sat' ? 'sat' : selectedCurrency.toLowerCase();

  const scrollY = useSharedValue(0);
  const topOffset = insets.top;

  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(250);
  const handleStickyLayout = useCallback(
    (event: { nativeEvent: { layout: { height: number } } }) => {
      setStickyHeaderHeight(event.nativeEvent.layout.height);
    },
    []
  );

  const handleAction = useCallback((action: HealthCta) => {
    log.info('health.action', {
      type: action.type,
      unit: 'unit' in action ? action.unit : undefined,
    });
    if (action.type === 'openPendingEcash') {
      router.navigate({
        pathname: '/transactions',
        params: { filterStatus: 'Pending' },
      });
      return;
    }
    if (action.type === 'openBalanceSplit') {
      router.navigate({ pathname: '/(mint-flow)/distribution', params: { unit: action.unit } });
      return;
    }
    if (action.type === 'openRebalancePlan') {
      router.navigate({ pathname: '/(mint-flow)/rebalancePlan', params: { unit: action.unit } });
      return;
    }
  }, []);

  const handleClose = useCallback(() => {
    hero.closeWalletHealth(unit);
  }, [hero, unit]);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          headerShadowVisible: false,
          headerTitle: '',
          headerBackVisible: false,
          headerTintColor: foreground,
          headerBlurEffect: 'none',
          headerBackground: () => null,
          headerLeft: () => (
            <TouchableOpacity onPress={handleClose} style={{ padding: 8 }}>
              <Icon name="material-symbols:close-rounded" size={24} color={foreground} />
            </TouchableOpacity>
          ),
        }}
      />

      <WalletHealthModalContent
        unit={unit}
        onAction={handleAction}
        topOffset={topOffset}
        currencies={availableCurrencies}
        selectedCurrency={selectedCurrency}
        onCurrencyChange={setSelectedCurrency}
        scrollY={scrollY}>
        {({ heroContent, tabsContent, bodyContent }) => (
          <RNView style={{ flex: 1 }}>
            <Screen
              name="HealthModalScreen"
              contentPadding={0}
              scroll="animated"
              scrollY={scrollY}
              bottomPadding={32}
              disableHeaderSpacer
              scrollIndicatorInsets={{
                top: Math.max(0, stickyHeaderHeight - nativeHeaderHeight),
              }}>
              <RNView style={{ height: stickyHeaderHeight }} />

              <RNView
                style={{
                  marginTop: -HEADER_OVERLAP,
                  paddingTop: HEADER_OVERLAP,
                }}>
                {bodyContent}
              </RNView>
            </Screen>

            <RNView
              style={styles.stickyHeader}
              pointerEvents="box-none"
              onLayout={handleStickyLayout}>
              <RNView>
                <RNView
                  style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: background, bottom: HEADER_OVERLAP },
                  ]}
                />
                <LinearGradient
                  colors={[background, opacity(background, 0)]}
                  style={styles.headerGradient}
                  pointerEvents="none"
                />

                {heroContent}

                <RNView style={{ marginTop: 10 }}>{tabsContent}</RNView>
              </RNView>
            </RNView>
          </RNView>
        )}
      </WalletHealthModalContent>
    </>
  );
}

const styles = StyleSheet.create({
  headerGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: HEADER_OVERLAP,
  },
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
});
