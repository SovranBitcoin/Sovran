/**
 * @fileoverview Standalone camera route wrapper
 *
 * This is the standalone version used for direct navigation.
 * Uses useProcessPaymentString hook for payment processing.
 */

import React, { useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useProcessPaymentString } from '@/hooks/coco/useProcessPaymentString';
import { CameraScreen, ScanningData } from 'components/screens/CameraScreen';

const Camera: React.FC = () => {
  const { unit } = useLocalSearchParams<{ unit: string }>();
  const { keys } = useNostrKeysContext();
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

  const handleClose = useCallback(() => {
    router.back();
  }, []);

  return (
    <CameraScreen
      onScan={handleScan}
      onReset={reset}
      showCustomCloseButton={true}
      onClose={handleClose}
    />
  );
};

export default Camera;
