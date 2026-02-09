/**
 * @fileoverview Standalone camera route wrapper
 *
 * This is the standalone version used for direct navigation.
 * Uses useProcessPaymentString hook for payment processing.
 * Header close button is handled via Stack.Screen headerLeft.
 */

import React, { useCallback } from 'react';
import { TouchableOpacity } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import Icon from 'assets/icons';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useTheme } from 'providers/ThemeProvider';
import { useProcessPaymentString } from '@/hooks/coco/useProcessPaymentString';
import { CameraScreen, ScanningData } from 'components/screens/CameraScreen';

const Camera: React.FC = () => {
  const { unit } = useLocalSearchParams<{ unit: string }>();
  const { keys } = useNostrKeysContext();
  const { getPrimaryColor } = useTheme();
  const selectedMints = useMintStore((state) => state.selectedMints);
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

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Scan QR',
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerTintColor: getPrimaryColor('0'),
          headerTitleStyle: { color: getPrimaryColor('0') },
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
              <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
            </TouchableOpacity>
          ),
        }}
      />
      <CameraScreen onScan={handleScan} onReset={reset} />
    </>
  );
};

export default Camera;
