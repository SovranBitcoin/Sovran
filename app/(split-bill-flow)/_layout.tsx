/**
 * @fileoverview Split-Bill flow layout.
 *
 * Root-level modal flow (slides up from bottom, mirroring `(send-flow)`
 * and `(receive-flow)`). Screens in order:
 *   1. `amount`        — enter total amount (custom keyboard, sat or fiat)
 *   2. `participants`  — multi-select picker: BLE peers + Nostr recents + self
 *   3. `search`        — modal route hosting Nostr profile search (opened from
 *                        the `participants` screen's headerRight magnifier)
 *   4. `summary`       — confirm + auto-deliver (orchestrator runs here)
 *   5. `detail`        — also reachable from Transactions list; shows per-
 *                        participant paid/pending status and QR fallback
 *
 * The picker hook is hoisted into this layout and exposed via
 * `PickerContext` so both the participants screen AND the search modal
 * share a single selection list + search state. Without this lift, the
 * modal would need its own picker instance and state would diverge.
 *
 * Uses the shared flow layout helper so the header styling matches the
 * rest of the app (close on first screen, back on subsequent).
 */

import { createContext, useContext } from 'react';
import { Stack } from 'expo-router';

import {
  useSplitBillParticipantPicker,
  type UseSplitBillParticipantPickerResult,
} from '@/features/splitBill/hooks/useSplitBillParticipantPicker';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

const PickerContext = createContext<UseSplitBillParticipantPickerResult | null>(null);

export function useSplitBillPickerContext(): UseSplitBillParticipantPickerResult {
  const ctx = useContext(PickerContext);
  if (!ctx) {
    throw new Error('useSplitBillPickerContext must be used inside SplitBillLayout');
  }
  return ctx;
}

export default function SplitBillLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  // One picker instance for the whole flow — survives navigation between
  // participants ↔ search, so selections made in the modal land back on
  // the main screen without any cross-route plumbing.
  const picker = useSplitBillParticipantPicker();

  return (
    <PickerContext.Provider value={picker}>
      <Stack screenOptions={createFlowLayoutScreenOptions({ foreground, background })}>
        <Stack.Screen name="amount" options={{ title: 'Split Bill' }} />
        <Stack.Screen name="participants" options={{ title: 'Who Pays' }} />
        <Stack.Screen
          name="search"
          options={{
            title: 'Search Nostr',
            presentation: 'modal',
            headerTransparent: false,
          }}
        />
        <Stack.Screen name="summary" options={{ title: 'Review' }} />
        <Stack.Screen name="detail" options={{ title: 'Split Bill' }} />
      </Stack>
    </PickerContext.Provider>
  );
}
