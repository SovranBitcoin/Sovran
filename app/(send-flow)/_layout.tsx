/**
 * @fileoverview Send Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within this group push horizontally:
 * - mintSelect: Entry point when no balance (shows mint list)
 * - nearPay: Nut Drop nearby BitChat peer picker before amount selection
 * - nearPayPeers: Scrollable nearby BitChat peer list
 * - amount: Amount selection (entry point when has balance)
 * - sendToken: Ecash token display after creation
 * - lightningSend: Lightning invoice payment
 * - onchainSend: Onchain payment
 * - meltQuote: legacy send quote dispatcher
 * - paymentRequest: NUT-18 payment request confirmation and delivery
 * - camera: QR code scanning
 *
 * The first screen shows a close button, subsequent screens show a back button.
 */

import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';
import { AndroidSheetRoot } from '@/shared/ui/composed/AndroidSheetRoot';
import { FLOW_SHEET_HEADER_HEIGHT } from '@/shared/ui/composed/FlowSheetHeader';

const MINT_SELECT_OPTIONS = { title: 'Select mint' };
const NEAR_PAY_HEADER_OPTIONS = {
  headerShadowVisible: false,
  headerTransparent: true,
} as const;
const NEAR_PAY_OPTIONS = {
  title: 'Nut Drop',
  ...NEAR_PAY_HEADER_OPTIONS,
};
const NEAR_PAY_PEERS_OPTIONS = {
  title: 'Nearby',
  ...NEAR_PAY_HEADER_OPTIONS,
};
const AMOUNT_OPTIONS = { title: 'Select amount' };
const SEND_TOKEN_OPTIONS = { title: 'Send ecash' };
const LIGHTNING_SEND_OPTIONS = {
  title: 'Send Lightning',
  headerBackButtonMenuEnabled: false,
};
const ONCHAIN_SEND_OPTIONS = {
  title: 'Send onchain',
  headerBackButtonMenuEnabled: false,
};
const MELT_QUOTE_OPTIONS = {
  title: 'Send',
  headerBackButtonMenuEnabled: false,
};
const PAYMENT_REQUEST_OPTIONS = {
  title: 'Payment request',
  headerBackButtonMenuEnabled: false,
};
const CAMERA_HEADER_STYLE = { backgroundColor: 'transparent' };
const CAMERA_OPTIONS = {
  title: 'Scan QR',
  headerStyle: CAMERA_HEADER_STYLE,
};

export default function SendFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = createFlowLayoutScreenOptions(
    { foreground, background },
    { androidSheet: true }
  );

  return (
    <AndroidSheetRoot headerHeight={FLOW_SHEET_HEADER_HEIGHT}>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="mintSelect" options={MINT_SELECT_OPTIONS} />
        <Stack.Screen name="nearPay" options={NEAR_PAY_OPTIONS} />
        <Stack.Screen name="nearPayPeers" options={NEAR_PAY_PEERS_OPTIONS} />
        <Stack.Screen name="amount" options={AMOUNT_OPTIONS} />
        <Stack.Screen name="sendToken" options={SEND_TOKEN_OPTIONS} />
        <Stack.Screen name="lightningSend" options={LIGHTNING_SEND_OPTIONS} />
        <Stack.Screen name="onchainSend" options={ONCHAIN_SEND_OPTIONS} />
        <Stack.Screen name="meltQuote" options={MELT_QUOTE_OPTIONS} />
        <Stack.Screen name="paymentRequest" options={PAYMENT_REQUEST_OPTIONS} />
        <Stack.Screen name="camera" options={CAMERA_OPTIONS} />
      </Stack>
    </AndroidSheetRoot>
  );
}
