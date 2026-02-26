import { useCallback, useMemo } from 'react';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Stack, router } from 'expo-router';
import { useWindowDimensions, View } from 'react-native';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useBtcPrice } from 'stores/pricelistStore';
import { useSettingsStore } from 'stores/settingsStore';
import { useBalanceContext, useManager } from 'coco-cashu-react';
import { useSendWithHistory } from '@/hooks/coco/useSendWithHistory';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WalletHeaderTitle from '@/components/blocks/WalletHeaderTitle';
import {
  AndroidLiquidHeaderOverlay,
  AndroidLiquidHeaderTitleButton,
  buildExpoRouterHeaderOptions,
  isAndroidLiquidHeaderSupported,
} from '@/components/navigation/expoRouter55';
import { useMintManagement } from '@/hooks/coco/useMintManagement';
import { NfcSuccessOverlay } from '@/components/overlays/NfcSuccessOverlay';
import {
  getHeaderTitleWidthFromWidth,
  getHeaderTitleHeight,
  getHeaderContentWidthFromWidth,
  getHeaderContentHeight,
  MOCK_NFC_SUCCESS_SATS,
} from '@/constants/wallet-header';
import { NfcSuccessOverlayContext } from '@/contexts/NfcSuccessOverlayContext';
import { useWalletHeaderState } from '@/hooks/useWalletHeaderState';
import { useNfcEcashPayment } from '@/hooks/useNfcEcashPayment';

// Re-export for consumers that imported from this layout (e.g. index.tsx)
export { HEADER_LAYOUT, MOCK_NFC_SUCCESS_SATS } from '@/constants/wallet-header';
export { useNfcSuccessOverlayMock } from '@/contexts/NfcSuccessOverlayContext';

export default function HomeLayout() {
  const iconColor = useThemeColor({}, 'text');
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const useAndroidLiquidHeader = isAndroidLiquidHeaderSupported();
  const { send } = useSendWithHistory();
  const manager = useManager();
  const { getMintInfo } = useMintManagement();
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
    getMintInfo,
  });

  const usdToSats = useCallback(
    (usd: number): number | undefined => {
      if (!btcPrice) return undefined;
      return Math.floor((usd / btcPrice) * 100_000_000);
    },
    [btcPrice]
  );

  const nfc = useNfcEcashPayment({
    send,
    manager: manager ?? undefined,
    availableMints,
    preferredMint: selectedMint,
    getSelectedMint,
    pubkey: keys?.pubkey,
    usdToSats,
  });

  const openDrawer = useCallback(() => {
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  const nfcOverlayContextValue = useMemo(
    () => ({ triggerMock: nfc.triggerNfcSuccessOverlayMock }),
    [nfc.triggerNfcSuccessOverlayMock]
  );

  return (
    <NfcSuccessOverlayContext.Provider value={nfcOverlayContextValue}>
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
        {nfc.nfcSuccessEntry || nfc.showNfcSuccessOverlayMock ? (
          <NfcSuccessOverlay
            onComplete={nfc.handleNfcSuccessOverlayComplete}
            amountSats={nfc.nfcSuccessEntry?.amount ?? MOCK_NFC_SUCCESS_SATS}
          />
        ) : null}
      </View>
    </NfcSuccessOverlayContext.Provider>
  );
}
