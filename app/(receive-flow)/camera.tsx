/**
 * @fileoverview Receive flow camera route wrapper
 *
 * Part of the (receive-flow) modal group - displays with back button.
 */

import React, { useCallback } from 'react';
import { Stack } from 'expo-router';
import { CameraScreen, ScanningData } from '@/features/camera';
import { usePaymentMachine } from '@/shared/hooks/usePaymentMachine';

const Camera: React.FC = () => {
  const { scan, resetUrDecoder } = usePaymentMachine();

  const handleScan = useCallback(
    async (data: ScanningData) => {
      const source = data.type === 'paste' || data.type === 'deeplink' ? data.type : 'qr';
      return scan(data.data, source);
    },
    [scan]
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
      <CameraScreen onScan={handleScan} onReset={resetUrDecoder} />
    </>
  );
};

export default Camera;
