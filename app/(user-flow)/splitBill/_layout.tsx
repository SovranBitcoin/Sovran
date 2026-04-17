/**
 * @fileoverview Split-Bill flow layout.
 *
 * Nested stack inside the `(user-flow)` modal. Screens in order:
 *   1. `amount`        — enter total amount (custom keyboard, sat or fiat)
 *   2. `participants`  — multi-select picker: BLE peers + Nostr recents + search
 *   3. `summary`       — confirm + auto-deliver (orchestrator runs here)
 *   4. `detail`        — also reachable from Transactions list; shows per-
 *                        participant paid/pending status and QR fallback
 *
 * Uses the shared flow layout helper so the header styling matches the rest
 * of the app (close on first screen, back on subsequent).
 */

import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../../config/flowLayoutOptions';

export default function SplitBillLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  return (
    <Stack screenOptions={createFlowLayoutScreenOptions({ foreground, background })}>
      <Stack.Screen name="amount" options={{ title: 'Split Bill' }} />
      <Stack.Screen name="participants" options={{ title: 'Who Pays' }} />
      <Stack.Screen name="summary" options={{ title: 'Review' }} />
      <Stack.Screen name="detail" options={{ title: 'Split Bill' }} />
    </Stack>
  );
}
