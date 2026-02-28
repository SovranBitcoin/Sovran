import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View as RNView } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/hooks/useThemeColor';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon from 'assets/icons';
import { ModalLayoutWrapper } from 'app/debugModal';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { WalletHealthModalContent } from 'components/blocks/health/WalletHealthModalContent';
import type { HealthCta } from 'components/blocks/health/walletHealth';
import { useMints } from 'coco-cashu-react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSharedValue } from 'react-native-reanimated';
import { useHeroTransition } from '@/components/ui/hero-transition/HeroTransitionProvider';
import { useHeaderHeight } from '@react-navigation/elements';

const DEFAULT_CURRENCIES = ['SAT'];
const HEADER_OVERLAP = 24; // content overlaps sticky header for gradient fade

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

function HealthModalScreen() {
  const params = useLocalSearchParams<{ unit?: string }>();
  const initialUnit = (params.unit || 'sat').toLowerCase();

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

  // Measured height of the sticky header (hero + tabs + gradient) for scroll spacer
  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(250);
  const handleStickyLayout = useCallback(
    (event: { nativeEvent: { layout: { height: number } } }) => {
      setStickyHeaderHeight(event.nativeEvent.layout.height);
    },
    []
  );

  const handleAction = useCallback((action: HealthCta) => {
    if (action.type === 'openPendingEcash') {
      router.navigate('/pendingEcash');
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
            {/* Scrollable content underneath the sticky header */}
            <ModalLayoutWrapper
              contentPadding={0}
              useAnimatedScroll
              scrollY={scrollY}
              bottomPadding={32}
              disableHeaderSpacer
              scrollIndicatorInsets={{
                top: Math.max(0, stickyHeaderHeight - nativeHeaderHeight),
              }}>
              {/* Spacer matching the sticky header height */}
              <RNView style={{ height: stickyHeaderHeight }} />

              {/* Actions / body content — overlaps the sticky header gradient */}
              <RNView
                style={{
                  marginTop: -HEADER_OVERLAP,
                  paddingTop: HEADER_OVERLAP,
                }}>
                {bodyContent}
              </RNView>
            </ModalLayoutWrapper>

            {/* Sticky header — always pinned at top, content scrolls behind it */}
            <RNView
              style={styles.stickyHeader}
              pointerEvents="box-none"
              onLayout={handleStickyLayout}>
              <RNView>
                {/* Background layers: solid covers top, gradient fades at bottom */}
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

                {/* Hero card */}
                {heroContent}

                {/* Currency tabs */}
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

export default withSheetProvider(HealthModalScreen);
