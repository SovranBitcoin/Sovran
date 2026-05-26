/**
 * @fileoverview Receive Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within this group push horizontally:
 * - receive: Entry point, shows receive options
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

const RECEIVE_OPTIONS = { title: 'Receive' };
const AMOUNT_OPTIONS = { title: 'Select Amount' };
const MINT_SELECT_OPTIONS = { title: 'Select Mint' };
const LIGHTNING_RECEIVE_OPTIONS = { title: 'Receive Lightning' };
const ONCHAIN_RECEIVE_OPTIONS = { title: 'Receive Onchain' };
const MINT_QUOTE_OPTIONS = { title: 'Receive' };
const RECEIVE_TOKEN_OPTIONS = { title: 'Receive Ecash' };
const CAMERA_HEADER_STYLE = { backgroundColor: 'transparent' };
const CAMERA_OPTIONS = {
  title: 'Scan QR',
  headerStyle: CAMERA_HEADER_STYLE,
};

export default function ReceiveFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }),
    [foreground, background]
  );

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="receive" options={RECEIVE_OPTIONS} />
      <Stack.Screen name="amount" options={AMOUNT_OPTIONS} />
      <Stack.Screen name="mintSelect" options={MINT_SELECT_OPTIONS} />
      <Stack.Screen name="lightningReceive" options={LIGHTNING_RECEIVE_OPTIONS} />
      <Stack.Screen name="onchainReceive" options={ONCHAIN_RECEIVE_OPTIONS} />
      <Stack.Screen name="mintQuote" options={MINT_QUOTE_OPTIONS} />
      <Stack.Screen name="receiveToken" options={RECEIVE_TOKEN_OPTIONS} />
      <Stack.Screen name="camera" options={CAMERA_OPTIONS} />
    </Stack>
  );
}
