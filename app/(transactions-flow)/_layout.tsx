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

import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';
import { TransactionsFilterProvider } from '@/features/transactions';

function TransactionsFlowContent() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  return (
    <Stack screenOptions={createFlowLayoutScreenOptions({ foreground, background })}>
      <Stack.Screen
        name="transactions"
        options={{
          title: 'Transactions',
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          contentStyle: {
            backgroundColor: background,
          },
        }}
      />
      <Stack.Screen name="mintQuote" options={{ title: 'Receive Lightning' }} />
      <Stack.Screen
        name="meltQuote"
        options={{ title: 'Send Lightning', headerBackButtonMenuEnabled: false }}
      />
      <Stack.Screen name="sendToken" options={{ title: 'Send Ecash' }} />
      <Stack.Screen name="receiveToken" options={{ title: 'Receive Ecash' }} />
      <Stack.Screen name="swap" options={{ title: 'Swap' }} />
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
