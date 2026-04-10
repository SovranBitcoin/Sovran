import { useCallback } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { DrawerActions, useNavigation } from '@react-navigation/native';

import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { MintSelector } from '@/features/wallet';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { buildExpoRouterHeaderOptions } from '@/navigation/nativeTabs';

export { HEADER_LAYOUT, MOCK_NFC_SUCCESS_SATS } from '@/features/wallet/lib/walletHeader';

export default function HomeLayout() {
  const iconColor = useThemeColor('foreground');
  const navigation = useNavigation();

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

  const handleNfcPayment = useCallback(() => {
    void machine.scan?.(undefined, { source: 'nfc' });
  }, [machine]);

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
            onHeaderRightPress: handleNfcPayment,
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
