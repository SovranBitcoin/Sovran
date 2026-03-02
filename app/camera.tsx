/**
 * @fileoverview Standalone camera route wrapper
 *
 * This is the standalone version used for direct navigation.
 * Uses useProcessPaymentString hook for payment processing.
 * Header close button is handled via Stack.Screen headerLeft.
 *
 * When opened with ?action=nfc-pay (e.g. from a home-screen widget),
 * the NFC no-limit payment flow starts automatically once the wallet is ready.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { TouchableOpacity } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import Icon from 'assets/icons';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useProcessPaymentString } from '@/hooks/coco/useProcessPaymentString';
import { useThemeColor } from '@/hooks/useThemeColor';
import { CameraScreen, ScanningData } from 'components/screens/CameraScreen';
import { useBalanceContext, useManager } from 'coco-cashu-react';
import { useSendWithHistory } from '@/hooks/coco/useSendWithHistory';
import { useNfcEcashPayment } from '@/hooks/useNfcEcashPayment';

const Camera: React.FC = () => {
  const { unit, action } = useLocalSearchParams<{ unit: string; action: string }>();
  const { keys } = useNostrKeysContext();
  const foreground = useThemeColor('foreground');
  const selectedMints = useMintStore((state) => state.selectedMints);
  const getSelectedMint = useMintStore((state) => state.getSelectedMint);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

  const { processPaymentString, reset } = useProcessPaymentString({
    unit,
    selectedMint,
    isFocused: true,
    onProgress: () => {},
    onLoading: () => {},
    onScanned: () => {},
  });

  const handleScan = useCallback(
    async (data: ScanningData) => {
      return processPaymentString(data);
    },
    [processPaymentString]
  );

  // NFC auto-start when opened with ?action=nfc-pay (widget deep link)
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
      <CameraScreen onScan={handleScan} onReset={reset} scanLocked={nfc.isPaying} />
    </>
  );
};

export default Camera;
