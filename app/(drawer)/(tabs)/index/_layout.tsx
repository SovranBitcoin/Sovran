import { useCallback, useMemo } from 'react';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Stack, router } from 'expo-router';
import { useWindowDimensions, View } from 'react-native';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useBtcPrice } from '@/shared/stores/global/pricelistStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useBalanceContext } from 'coco-cashu-react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WalletHeaderTitle, useWalletHeaderState } from '@/features/wallet';
import { useMintManagement } from '@/features/mint';
import {
  AndroidLiquidHeaderOverlay,
  AndroidLiquidHeaderTitleButton,
  buildExpoRouterHeaderOptions,
  isAndroidLiquidHeaderSupported,
} from '@/navigation/nativeTabs';
import {
  getHeaderTitleWidthFromWidth,
  getHeaderTitleHeight,
  getHeaderContentWidthFromWidth,
  getHeaderContentHeight,
} from '@/features/wallet/lib/walletHeader';
import { usePaymentMachine } from '@/shared/hooks/usePaymentMachine';

export { HEADER_LAYOUT, MOCK_NFC_SUCCESS_SATS } from '@/features/wallet/lib/walletHeader';

export default function HomeLayout() {
  const iconColor = useThemeColor('foreground');
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const useAndroidLiquidHeader = isAndroidLiquidHeaderSupported();
  const { mints, isLoading: isMintsLoading } = useMintManagement();
  const { keys } = useNostrKeysContext();
  const getSelectedMint = useMintStore((state) => state.getSelectedMint);
  const selectedMint = keys?.pubkey ? getSelectedMint(keys.pubkey) : undefined;
  const { balance: balancesWithTotal } = useBalanceContext();
  const { total: _total, ...availableMints } = balancesWithTotal;
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);
  const btcPrice = useBtcPrice(displayCurrency);

  const headerTitleWidth = useMemo(() => getHeaderTitleWidthFromWidth(windowWidth), [windowWidth]);
  const headerContentWidth = useMemo(
    () => getHeaderContentWidthFromWidth(windowWidth),
    [windowWidth]
  );

  const headerBalance = selectedMint ? balancesWithTotal[selectedMint] || 0 : 0;
  const header = useWalletHeaderState({
    selectedMint,
    balanceForMint: headerBalance,
    mints,
    isMintsLoading,
  });

  const usdToSats = useCallback(
    (usd: number): number | undefined => {
      if (!btcPrice) return undefined;
      return Math.floor((usd / btcPrice) * 100_000_000);
    },
    [btcPrice]
  );

  const nfc = usePaymentMachine({
    availableMints,
    preferredMint: selectedMint,
    getSelectedMint,
    pubkey: keys?.pubkey,
    usdToSats,
  });

  const openDrawer = useCallback(() => {
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: 'transparent' },
        }}>
        <Stack.Screen
          name="index"
          options={buildExpoRouterHeaderOptions({
            iconColor,
            headerLeftIcon: 'line.3.horizontal',
            onHeaderLeftPress: openDrawer,
            headerRightIcon: 'wave.3.right',
            onHeaderRightPress: nfc.handleNfcPaymentAlert,
            options: {
              headerShown: !useAndroidLiquidHeader,
              headerTransparent: true,
              headerTitleAlign: 'center',
              headerTitle: () => (
                <WalletHeaderTitle
                  liquidGlass
                  style={{ width: headerTitleWidth, height: getHeaderTitleHeight() }}
                  contentWidth={headerContentWidth}
                  contentHeight={getHeaderContentHeight()}
                />
              ),
            },
          })}
        />
      </Stack>
      {useAndroidLiquidHeader ? (
        <AndroidLiquidHeaderOverlay
          topInset={insets.top}
          iconColor={iconColor}
          leftIcon="line.3.horizontal"
          onLeftPress={openDrawer}
          rightIcon="wave.3.right"
          onRightPress={nfc.handleNfcPaymentAlert}
          centerWidth={headerTitleWidth}
          center={
            <AndroidLiquidHeaderTitleButton
              width={headerTitleWidth}
              lineOneText={header.headerMintName}
              lineTwoText={header.headerAmountLabel}
              avatarName={header.headerMintName}
              avatarPicture={header.headerMintInfo?.icon_url}
              onPress={() => {
                router.navigate('/(mint-flow)/list' as any);
              }}
            />
          }
        />
      ) : null}
    </View>
  );
}
