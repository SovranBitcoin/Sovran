/**
 * @fileoverview Transactions Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within this group push horizontally:
 * - transactions: Entry point, shows transaction list with native header
 * - mintQuote: Lightning receive details (pushes horizontally)
 * - meltQuote: Lightning send details (pushes horizontally)
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
const MINT_QUOTE_OPTIONS = { title: 'Receive Lightning' };
const MELT_QUOTE_OPTIONS = {
  title: 'Send Lightning',
  headerBackButtonMenuEnabled: false,
};
const SEND_TOKEN_OPTIONS = { title: 'Send Ecash' };
const RECEIVE_TOKEN_OPTIONS = { title: 'Receive Ecash' };
const SWAP_OPTIONS = { title: 'Swap' };

function TransactionsFlowContent() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }),
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
      <Stack.Screen name="mintQuote" options={MINT_QUOTE_OPTIONS} />
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
