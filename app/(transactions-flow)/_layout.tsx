/**
 * @fileoverview Transactions Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within this group push horizontally:
 * - transactions: Entry point, shows transaction list with custom collapsing header
 * - mintQuote: Lightning receive details (pushes horizontally)
 * - meltQuote: Lightning send details (pushes horizontally)
 * - sendToken: Ecash send details (pushes horizontally)
 * - receiveToken: Ecash receive details (pushes horizontally)
 *
 * The first screen shows a close button, subsequent screens show a back button.
 * The transactions screen uses a custom CollapsingHeader instead of native large title
 * for more reliable animation behavior.
 */

import { Stack } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';
import { TransactionsFilterProvider } from 'components/screens/TransactionsFilterContext';

function TransactionsFlowContent() {
  const { getPrimaryColor } = useTheme();

  return (
    <Stack screenOptions={createFlowLayoutScreenOptions(getPrimaryColor)}>
      <Stack.Screen
        name="transactions"
        options={{
          headerShown: false, // Using custom CollapsingHeader instead
          contentStyle: {
            backgroundColor: getPrimaryColor('950'),
          },
        }}
      />
      <Stack.Screen name="mintQuote" options={{ title: 'Receive Lightning' }} />
      <Stack.Screen name="meltQuote" options={{ title: 'Send Lightning' }} />
      <Stack.Screen name="sendToken" options={{ title: 'Send Ecash' }} />
      <Stack.Screen name="receiveToken" options={{ title: 'Receive Ecash' }} />
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
