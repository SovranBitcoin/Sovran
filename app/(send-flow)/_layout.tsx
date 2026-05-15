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

import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

const MINT_SELECT_OPTIONS = { title: 'Select Mint' };
const AMOUNT_OPTIONS = { title: 'Select Amount' };
const SEND_TOKEN_OPTIONS = { title: 'Send Ecash' };
const MELT_QUOTE_OPTIONS = {
  title: 'Send Lightning',
  headerBackButtonMenuEnabled: false,
};
const PAYMENT_REQUEST_OPTIONS = {
  title: 'Payment Request',
  headerBackButtonMenuEnabled: false,
};
const CAMERA_HEADER_STYLE = { backgroundColor: 'transparent' };
const CAMERA_OPTIONS = {
  title: 'Scan QR',
  headerStyle: CAMERA_HEADER_STYLE,
};

export default function SendFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }),
    [foreground, background]
  );

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="mintSelect" options={MINT_SELECT_OPTIONS} />
      <Stack.Screen name="amount" options={AMOUNT_OPTIONS} />
      <Stack.Screen name="sendToken" options={SEND_TOKEN_OPTIONS} />
      <Stack.Screen name="meltQuote" options={MELT_QUOTE_OPTIONS} />
      <Stack.Screen name="paymentRequest" options={PAYMENT_REQUEST_OPTIONS} />
      <Stack.Screen name="camera" options={CAMERA_OPTIONS} />
    </Stack>
  );
}
