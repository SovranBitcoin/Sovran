/**
 * @fileoverview Send Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within this group push horizontally:
 * - mintSelect: Entry point when no balance (shows mint list)
 * - amount: Amount selection (entry point when has balance)
 * - sendToken: Ecash token display after creation
 * - meltQuote: Lightning invoice payment
 * - paymentRequest: NUT-18 payment request confirmation and delivery
 * - camera: QR code scanning
 *
 * The first screen shows a close button, subsequent screens show a back button.
 */

import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

export default function SendFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  return (
    <Stack screenOptions={createFlowLayoutScreenOptions({ foreground, background })}>
      <Stack.Screen name="mintSelect" options={{ title: 'Select Mint' }} />
      <Stack.Screen name="amount" options={{ title: 'Select Amount' }} />
      <Stack.Screen name="sendToken" options={{ title: 'Send Ecash' }} />
      <Stack.Screen
        name="meltQuote"
        options={{ title: 'Send Lightning', headerBackButtonMenuEnabled: false }}
      />
      <Stack.Screen name="paymentRequest" options={{ title: 'Payment Request' }} />
      <Stack.Screen
        name="camera"
        options={{
          title: 'Scan QR',
          headerStyle: { backgroundColor: 'transparent' },
        }}
      />
    </Stack>
  );
}
