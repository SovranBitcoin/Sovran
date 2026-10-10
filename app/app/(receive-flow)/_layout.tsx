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
 *
 * The first screen shows a close button, subsequent screens show a back button.
 */

import { Stack } from 'expo-router';
import { railHeaderTitle } from 'wallet';

import { AndroidSheetFlowStack, MINT_SELECT_SCREEN_OPTIONS } from '../../config/flowLayoutOptions';

const RECEIVE_OPTIONS = { title: 'Receive' };
const AMOUNT_OPTIONS = { title: 'Select amount' };
const LIGHTNING_RECEIVE_OPTIONS = { title: railHeaderTitle('lightningReceive') };
const ONCHAIN_RECEIVE_OPTIONS = { title: railHeaderTitle('onchainReceive') };
const MINT_QUOTE_OPTIONS = { title: 'Receive' };
const RECEIVE_TOKEN_OPTIONS = { title: railHeaderTitle('ecashReceive') };
const RAIL_LIST_OPTIONS = { title: 'View all' };
const MESSAGE_ECASH_OPTIONS = { title: 'To receive' };
const CAMERA_HEADER_STYLE = { backgroundColor: 'transparent' };
const CAMERA_OPTIONS = {
  title: 'Scan QR',
  headerStyle: CAMERA_HEADER_STYLE,
};

export default function ReceiveFlowLayout() {
  return (
    <AndroidSheetFlowStack flow="(receive-flow)">
      <Stack.Screen name="receive" options={RECEIVE_OPTIONS} />
      <Stack.Screen name="qrDisplay" options={RECEIVE_OPTIONS} />
      <Stack.Screen name="amount" options={AMOUNT_OPTIONS} />
      <Stack.Screen name="mintSelect" options={MINT_SELECT_SCREEN_OPTIONS} />
      <Stack.Screen name="lightningReceive" options={LIGHTNING_RECEIVE_OPTIONS} />
      <Stack.Screen name="onchainReceive" options={ONCHAIN_RECEIVE_OPTIONS} />
      <Stack.Screen name="paymentRequest" options={MINT_QUOTE_OPTIONS} />
      <Stack.Screen name="receiveToken" options={RECEIVE_TOKEN_OPTIONS} />
      <Stack.Screen name="railList" options={RAIL_LIST_OPTIONS} />
      <Stack.Screen name="messageEcash" options={MESSAGE_ECASH_OPTIONS} />
      <Stack.Screen name="camera" options={CAMERA_OPTIONS} />
    </AndroidSheetFlowStack>
  );
}
