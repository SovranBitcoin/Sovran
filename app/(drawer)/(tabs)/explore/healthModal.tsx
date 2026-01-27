import React, { useCallback, useMemo, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
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

const DEFAULT_CURRENCIES = ['SAT'];

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

  const { getPrimaryColor } = useTheme();
  const hero = useHeroTransition();
  const insets = useSafeAreaInsets();
  const { trustedMints } = useMints();

  const currencies = useMemo(() => getCurrenciesFromMints(trustedMints), [trustedMints]);
  const [selectedCurrency, setSelectedCurrency] = useState<string>(
    initialUnit.toUpperCase() === 'BTC' ? 'SAT' : initialUnit.toUpperCase()
  );
  const availableCurrencies = currencies.length > 0 ? currencies : DEFAULT_CURRENCIES;
  const unit = selectedCurrency.toLowerCase() === 'sat' ? 'sat' : selectedCurrency.toLowerCase();

  const scrollY = useSharedValue(0);
  // This value affects the destination hero rect (via `marginTop: -topOffset`).
  // Only pull the hero under the safe-area. If we include custom header height here,
  // the card ends up “too high” (negative y) and the shared element overshoots.
  const topOffset = insets.top;

  const handleAction = useCallback((action: HealthCta) => {
    if (action.type === 'openPendingEcash') {
      router.push('/pendingEcash');
      return;
    }
    if (action.type === 'openBalanceSplit') {
      router.push({ pathname: '/(mint-flow)/distribution', params: { unit: action.unit } });
      return;
    }
    if (action.type === 'openRebalancePlan') {
      router.push({ pathname: '/(mint-flow)/rebalancePlan', params: { unit: action.unit } });
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
          // Header: close button only (no title, no blur).
          headerShown: true,
          headerTransparent: true,
          headerShadowVisible: false,
          headerTitle: '',
          headerBackVisible: false,
          headerTintColor: getPrimaryColor('0'),
          // Prevent the default dark blur background.
          headerBlurEffect: 'none',
          headerBackground: () => null,
          headerLeft: () => (
            <TouchableOpacity onPress={handleClose} style={{ padding: 8 }}>
              <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
            </TouchableOpacity>
          ),
        }}
      />

      <ModalLayoutWrapper
        contentPadding={0}
        useAnimatedScroll
        scrollY={scrollY}
        bottomPadding={32}
        disableHeaderSpacer>
        <WalletHealthModalContent
          unit={unit}
          onAction={handleAction}
          topOffset={topOffset}
          currencies={availableCurrencies}
          selectedCurrency={selectedCurrency}
          onCurrencyChange={setSelectedCurrency}
          scrollY={scrollY}
        />
      </ModalLayoutWrapper>
    </>
  );
}

export default withSheetProvider(HealthModalScreen);
