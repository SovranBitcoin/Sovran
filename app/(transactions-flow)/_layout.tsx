/**
 * @fileoverview Transactions Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within this group push horizontally:
 * - transactions: Entry point, shows transaction list with native header
 * - lightningReceive: Lightning receive details (pushes horizontally)
 * - onchainReceive: Onchain receive details (pushes horizontally)
 * - lightningSend: Lightning send details (pushes horizontally)
 * - onchainSend: Onchain send details (pushes horizontally)
 * - mintQuote/meltQuote: legacy quote dispatchers
 * - sendToken: Ecash send details (pushes horizontally)
 * - receiveToken: Ecash receive details (pushes horizontally)
 *
 * The first screen shows a close button, subsequent screens show a back button.
 * Uses native header for liquid glass button animations.
 */

import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';
import { TransactionsFilterProvider } from '@/features/transactions';

const TRANSPARENT_HEADER_STYLE = { backgroundColor: 'transparent' };
const LIGHTNING_RECEIVE_OPTIONS = { title: 'Receive Lightning' };
const ONCHAIN_RECEIVE_OPTIONS = { title: 'Receive onchain' };
const MINT_QUOTE_OPTIONS = { title: 'Receive' };
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
const SEND_TOKEN_OPTIONS = { title: 'Send ecash' };
const RECEIVE_TOKEN_OPTIONS = { title: 'Receive ecash' };
const SWAP_OPTIONS = { title: 'Swap' };

function TransactionsFlowContent() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }, { androidSheet: true }),
    [foreground, background]
  );
  const transactionsOptions = useMemo(
    () => ({
      title: 'Transactions',
      headerTransparent: true,
      headerStyle: TRANSPARENT_HEADER_STYLE,
      contentStyle: {
        backgroundColor: background,
      },
    }),
    [background]
  );

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="transactions" options={transactionsOptions} />
      <Stack.Screen name="lightningReceive" options={LIGHTNING_RECEIVE_OPTIONS} />
      <Stack.Screen name="onchainReceive" options={ONCHAIN_RECEIVE_OPTIONS} />
      <Stack.Screen name="mintQuote" options={MINT_QUOTE_OPTIONS} />
      <Stack.Screen name="lightningSend" options={LIGHTNING_SEND_OPTIONS} />
      <Stack.Screen name="onchainSend" options={ONCHAIN_SEND_OPTIONS} />
      <Stack.Screen name="meltQuote" options={MELT_QUOTE_OPTIONS} />
      <Stack.Screen name="sendToken" options={SEND_TOKEN_OPTIONS} />
      <Stack.Screen name="receiveToken" options={RECEIVE_TOKEN_OPTIONS} />
      <Stack.Screen name="swap" options={SWAP_OPTIONS} />
    </Stack>
  );
}

export default function TransactionsFlowLayout() {
  return (
    <TransactionsFilterProvider>
      <TransactionsFlowContent />
    </TransactionsFilterProvider>
  );
}
