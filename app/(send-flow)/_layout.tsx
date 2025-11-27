/**
 * @fileoverview Send Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within this group push horizontally:
 * - mintSelect: Entry point when no balance (shows mint list)
 * - currency: Amount selection (entry point when has balance)
 * - sendToken: Ecash token display after creation
 * - meltQuote: Lightning invoice payment
 * - camera: QR code scanning
 *
 * The first screen shows a close button, subsequent screens show a back button.
 */

import { Stack } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { createFlowLayoutScreenOptions } from '../../components/__layout.modals.config';

export default function SendFlowLayout() {
  const { getPrimaryColor } = useTheme();

  return (
    <Stack screenOptions={createFlowLayoutScreenOptions(getPrimaryColor)}>
      <Stack.Screen name="mintSelect" options={{ title: 'Select Mint' }} />
      <Stack.Screen name="currency" options={{ title: 'Select Amount' }} />
      <Stack.Screen name="sendToken" options={{ title: 'Send Ecash' }} />
      <Stack.Screen name="meltQuote" options={{ title: 'Send Lightning' }} />
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
