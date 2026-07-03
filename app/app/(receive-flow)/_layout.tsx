/**
 * @fileoverview Receive Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within this group push horizontally:
 * - receive: Entry point, the receive hub (QR Display / Scan QR / Fixed Amount / Paste)
 * - qrDisplay: Standing receive rails (Unified / Lightning / Onchain / Cashu tabs)
 * - amount: Amount selector (pushes horizontally)
 * - lightningReceive: Lightning receive display (pushes horizontally)
 * - onchainReceive: Onchain receive display (pushes horizontally)
 * - mintQuote: legacy receive quote dispatcher
 *
 * The first screen shows a close button, subsequent screens show a back button.
 */

import { useMemo } from 'react';
import { Stack } from 'expo-router';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';
import { AndroidSheetRoot } from '@/shared/ui/composed/AndroidSheetRoot';
import { FLOW_SHEET_HEADER_HEIGHT } from '@/shared/ui/composed/FlowSheetHeader';

const RECEIVE_OPTIONS = { title: 'Receive' };
const AMOUNT_OPTIONS = { title: 'Select amount' };
const MINT_SELECT_OPTIONS = { title: 'Select mint' };
const LIGHTNING_RECEIVE_OPTIONS = { title: 'Receive Lightning' };
const ONCHAIN_RECEIVE_OPTIONS = { title: 'Receive onchain' };
const MINT_QUOTE_OPTIONS = { title: 'Receive' };
const RECEIVE_TOKEN_OPTIONS = { title: 'Receive ecash' };
const CAMERA_HEADER_STYLE = { backgroundColor: 'transparent' };
const CAMERA_OPTIONS = {
  title: 'Scan QR',
  headerStyle: CAMERA_HEADER_STYLE,
};

export default function ReceiveFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }, { androidSheet: true }),
    [foreground, background]
  );

  return (
    <AndroidSheetRoot headerHeight={FLOW_SHEET_HEADER_HEIGHT}>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="receive" options={RECEIVE_OPTIONS} />
        <Stack.Screen name="qrDisplay" options={RECEIVE_OPTIONS} />
        <Stack.Screen name="amount" options={AMOUNT_OPTIONS} />
        <Stack.Screen name="mintSelect" options={MINT_SELECT_OPTIONS} />
        <Stack.Screen name="lightningReceive" options={LIGHTNING_RECEIVE_OPTIONS} />
        <Stack.Screen name="onchainReceive" options={ONCHAIN_RECEIVE_OPTIONS} />
        <Stack.Screen name="mintQuote" options={MINT_QUOTE_OPTIONS} />
        <Stack.Screen name="paymentRequest" options={MINT_QUOTE_OPTIONS} />
        <Stack.Screen name="receiveToken" options={RECEIVE_TOKEN_OPTIONS} />
        <Stack.Screen name="camera" options={CAMERA_OPTIONS} />
      </Stack>
    </AndroidSheetRoot>
  );
}
