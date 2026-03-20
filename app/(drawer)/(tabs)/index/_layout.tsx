import { useCallback } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { DrawerActions, useNavigation } from '@react-navigation/native';

import { useBalanceContext, useManager } from 'coco-cashu-react';

import { useSendWithHistory } from '@/features/send';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { MintSelector } from '@/features/wallet';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNfcEcashPayment } from '@/shared/hooks/useNfcEcashPayment';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useBtcPrice } from '@/shared/stores/global/pricelistStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { buildExpoRouterHeaderOptions } from '@/navigation/nativeTabs';

export { HEADER_LAYOUT, MOCK_NFC_SUCCESS_SATS } from '@/features/wallet/lib/walletHeader';

export default function HomeLayout() {
  const iconColor = useThemeColor('foreground');
  const navigation = useNavigation();
  const { send } = useSendWithHistory();
  const manager = useManager();
  const { keys } = useNostrKeysContext();
  const getSelectedMint = useMintStore((state) => state.getSelectedMint);
  const selectedMint = keys?.pubkey ? getSelectedMint(keys.pubkey) : undefined;
  const { balance: balancesWithTotal } = useBalanceContext();
  const { total: _total, ...availableMints } = balancesWithTotal;
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);
  const btcPrice = useBtcPrice(displayCurrency);

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

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

  const handleMintSelected = useCallback(
    (mintUrl: string) => {
      void machine.changeMint(mintUrl);
    },
    [machine]
  );

  const handleRequestMintList = useCallback(() => {
    void machine.requestMintSelector({ reset: true });
  }, [machine]);

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
              headerTransparent: true,
              headerTitleAlign: 'center',
              headerTitle: () => (
                <MintSelector
                  onMintSelected={handleMintSelected}
                  onRequestMintList={handleRequestMintList}
                />
              ),
            },
          })}
        />
      </Stack>
    </View>
  );
}
