/**
 * @fileoverview Transactions Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within this group push horizontally:
 * - transactions: Entry point, shows transaction list
 * - mintQuote: Lightning receive details (pushes horizontally)
 * - meltQuote: Lightning send details (pushes horizontally)
 * - sendToken: Ecash send details (pushes horizontally)
 * - receiveToken: Ecash receive details (pushes horizontally)
 *
 * The first screen shows a close button, subsequent screens show a back button.
 */

import { Stack } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { createFlowLayoutScreenOptions } from '../_layout.modals.config';

export default function TransactionsFlowLayout() {
  const { getPrimaryColor } = useTheme();

  return (
    <Stack screenOptions={createFlowLayoutScreenOptions(getPrimaryColor)}>
      <Stack.Screen name="transactions" options={{ title: 'Transactions' }} />
      <Stack.Screen name="mintQuote" options={{ title: 'Receive Lightning' }} />
      <Stack.Screen name="meltQuote" options={{ title: 'Send Lightning' }} />
      <Stack.Screen name="sendToken" options={{ title: 'Send Ecash' }} />
      <Stack.Screen name="receiveToken" options={{ title: 'Receive Ecash' }} />
    </Stack>
  );
}
