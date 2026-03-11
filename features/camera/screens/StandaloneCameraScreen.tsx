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
import { useProcessPaymentString, useSendWithHistory } from '@/features/send';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNfcEcashPayment } from '@/shared/hooks/useNfcEcashPayment';

export function StandaloneCameraScreen() {
  const { unit, action } = useLocalSearchParams<{ unit: string; action: string }>();
  const { keys } = useNostrKeysContext();
  const foreground = useThemeColor('foreground');
  const selectedMints = useMintStore((state) => state.selectedMints);
  const getSelectedMint = useMintStore((state) => state.getSelectedMint);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

  const unlockCameraRef = useRef<(() => void) | null>(null);

  const { processPaymentString, reset } = useProcessPaymentString({
    unit,
    selectedMint,
    isFocused: true,
    onProgress: () => {},
    onLoading: () => {},
    onScanned: () => {},
    onUnlockCamera: () => unlockCameraRef.current?.(),
  });

  const handleScan = useCallback(
    async (data: ScanningData) => {
      return processPaymentString(data);
    },
    [processPaymentString]
  );

  const { send } = useSendWithHistory();
  const manager = useManager();
  const { balance: balancesWithTotal } = useBalanceContext();
  const { total: _total, ...availableMints } = balancesWithTotal;

  const nfc = useNfcEcashPayment({
    send,
    manager: manager ?? undefined,
    availableMints,
    preferredMint: selectedMint,
    getSelectedMint,
    pubkey: keys?.pubkey,
    usdToSats: () => undefined,
  });

  const nfcFiredRef = useRef(false);
  const shouldAutoStartNfc = Array.isArray(action)
    ? action.includes('nfc-pay')
    : action === 'nfc-pay';

  useEffect(() => {
    if (!shouldAutoStartNfc) {
      nfcFiredRef.current = false;
      return;
    }

    if (nfc.isIdle && manager && !nfcFiredRef.current) {
      nfcFiredRef.current = true;
      nfc.startPayment();
    }
  }, [shouldAutoStartNfc, nfc, manager]);

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
      <CameraScreen
        onScan={handleScan}
        onReset={reset}
        scanLocked={nfc.isPaying}
        onRegisterUnlock={(fn) => {
          unlockCameraRef.current = fn;
        }}
      />
    </>
  );
}
