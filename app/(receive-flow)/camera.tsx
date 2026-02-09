/**
 * @fileoverview Receive flow camera route wrapper
 *
 * Part of the (receive-flow) modal group - displays with back button.
 * Uses useProcessPaymentString hook for payment processing.
 */

import React, { useCallback } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useMintStore } from 'stores/mintStore';
import { useProcessPaymentString } from '@/hooks/coco/useProcessPaymentString';
import { CameraScreen, ScanningData } from 'components/screens/CameraScreen';

const Camera: React.FC = () => {
  const { unit } = useLocalSearchParams<{ unit: string }>();
  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

  const { processPaymentString, reset } = useProcessPaymentString({
    unit: unit || 'sat',
    selectedMint,
    isFocused: true,
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
        }}
      />
      <CameraScreen onScan={handleScan} onReset={reset} />
    </>
  );
};

export default Camera;
