/**
 * @fileoverview Receive Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within this group push horizontally:
 * - receive: Entry point, shows receive options
 * - amount: Amount selector (pushes horizontally)
 * - mintQuote: Lightning invoice display (pushes horizontally)
 *
 * The first screen shows a close button, subsequent screens show a back button.
 */

import { useCallback } from 'react';
import { Stack } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';

import { ReceivePaymentUXExtrasProvider } from '@/features/receive/providers/ReceivePaymentUXExtras';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

export default function ReceiveFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const [hasPermission, requestPermission] = useCameraPermissions();

  const requestCameraPermission = useCallback(async () => {
    if (hasPermission?.granted) return true;
    const result = await requestPermission();
    return result.granted;
  }, [hasPermission?.granted, requestPermission]);

  return (
    <ReceivePaymentUXExtrasProvider requestCameraPermission={requestCameraPermission}>
      <Stack screenOptions={createFlowLayoutScreenOptions({ foreground, background })}>
        <Stack.Screen name="receive" options={{ title: 'Receive' }} />
        <Stack.Screen name="amount" options={{ title: 'Select Amount' }} />
        <Stack.Screen name="mintSelect" options={{ title: 'Select Mint' }} />
        <Stack.Screen name="mintQuote" options={{ title: 'Receive Lightning' }} />
        <Stack.Screen name="receiveToken" options={{ title: 'Receive Ecash' }} />
        <Stack.Screen
          name="camera"
          options={{
            title: 'Scan QR',
            headerStyle: { backgroundColor: 'transparent' },
          }}
        />
      </Stack>
    </ReceivePaymentUXExtrasProvider>
  );
}
