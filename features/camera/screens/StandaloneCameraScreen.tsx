/**
 * Standalone camera screen orchestration for direct navigation.
 * Keeps route files thin while reusing the shared CameraScreen UI.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { TouchableOpacity } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useBalanceContext, useManager } from 'coco-cashu-react';

import Icon from 'assets/icons';
import { CameraScreen, ScanningData } from '@/features/camera';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { usePaymentMachine } from '@/shared/hooks/usePaymentMachine';

export function StandaloneCameraScreen() {
  const { action } = useLocalSearchParams<{ unit: string; action: string }>();
  const { keys } = useNostrKeysContext();
  const foreground = useThemeColor('foreground');
  const getSelectedMint = useMintStore((state) => state.getSelectedMint);
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

  const manager = useManager();
  const { balance: balancesWithTotal } = useBalanceContext();
  const { total: _total, ...availableMints } = balancesWithTotal;

  const machine = usePaymentMachine({
    availableMints,
    preferredMint: selectedMint,
    getSelectedMint,
    pubkey: keys?.pubkey,
    usdToSats: () => undefined,
  });

  const { scan, resetUrDecoder, isNfcIdle, startNfcPayment } = machine;

  const handleScan = useCallback(
    async (data: ScanningData) => {
      const source = data.type === 'paste' || data.type === 'deeplink' ? data.type : 'qr';
      return scan(data.data, source);
    },
    [scan],
  );

  const nfcFiredRef = useRef(false);
  const shouldAutoStartNfc = Array.isArray(action)
    ? action.includes('nfc-pay')
    : action === 'nfc-pay';

  useEffect(() => {
    if (!shouldAutoStartNfc) {
      nfcFiredRef.current = false;
      return;
    }

    if (isNfcIdle && manager && !nfcFiredRef.current) {
      nfcFiredRef.current = true;
      startNfcPayment();
    }
  }, [shouldAutoStartNfc, isNfcIdle, manager, startNfcPayment]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Scan QR',
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerTintColor: foreground,
          headerTitleStyle: { color: foreground },
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace('/');
                }
              }}
              style={{ padding: 8 }}>
              <Icon name="material-symbols:close-rounded" size={24} color={foreground} />
            </TouchableOpacity>
          ),
        }}
      />
      <CameraScreen onScan={handleScan} onReset={resetUrDecoder} scanLocked={machine.isNfcPaying} />
    </>
  );
}
