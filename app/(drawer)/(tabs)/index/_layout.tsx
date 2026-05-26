import { useCallback } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { DrawerActions, useNavigation } from '@react-navigation/native';

import { usePaymentFlowMachine } from 'colada/react';
import { MintSelector } from '@/features/wallet';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { buildExpoRouterHeaderOptions } from '@/navigation/nativeTabs';
import { HeaderProfileButton } from '@/shared/blocks/HeaderProfileButton';

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
            headerLeft: () => <HeaderProfileButton onPress={openDrawer} />,
            headerRightIcon: 'wave.3.right',
            onHeaderRightPress: handleNfcPayment,
            options: {
              headerTransparent: true,
              headerTitleAlign: 'center',
              headerTitle: () => <MintSelector onRequestMintList={handleRequestMintList} />,
            },
          })}
        />
      </Stack>
    </View>
  );
}
