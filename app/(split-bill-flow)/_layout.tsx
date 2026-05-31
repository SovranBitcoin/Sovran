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
 * To keep the keypad on `amount` responsive, the hook's expensive
 * subscriptions (NDK relay subs, NIP-17 unwrap, NIP-04 decrypt, kind-0
 * profile metadata, image prefetch) are gated behind an `enabled` flag
 * derived from `useSegments`. The context provider is mounted
 * unconditionally so consumers never see a null context — the hook
 * just returns empty sections until activation. Activation is sticky:
 * once the user first visits a picker-consuming route, the
 * subscriptions stay live for the rest of the flow lifetime so
 * navigating back to `amount` and forward again is instant.
 *
 * Uses the shared flow layout helper so the header styling matches the
 * rest of the app (close on first screen, back on subsequent).
 */

import React, { createContext, useContext, useMemo, useState } from 'react';
import { Stack, useSegments } from 'expo-router';

import {
  useSplitBillParticipantPicker,
  type UseSplitBillParticipantPickerResult,
} from '@/features/splitBill/hooks/useSplitBillParticipantPicker';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

const PickerContext = createContext<UseSplitBillParticipantPickerResult | null>(null);
const AMOUNT_OPTIONS = { title: 'Split bill' };
const PARTICIPANTS_OPTIONS = { title: 'Who pays' };
const SEARCH_OPTIONS = {
  title: 'Search Nostr',
  presentation: 'modal',
  headerTransparent: false,
} as const;
const SUMMARY_OPTIONS = { title: 'Review' };
const DETAIL_OPTIONS = { title: 'Split bill' };

export function useSplitBillPickerContext(): UseSplitBillParticipantPickerResult {
  const ctx = useContext(PickerContext);
  if (!ctx) {
    throw new Error('useSplitBillPickerContext must be used inside SplitBillLayout');
  }
  return ctx;
}

/** Routes that consume picker state. Other routes mount with the picker
 *  in dormant mode (no NDK subs, no decryption work). */
const PICKER_ROUTES = new Set(['participants', 'search']);

export default function SplitBillLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }),
    [foreground, background]
  );
  const segments = useSegments();
  const needsPickerNow = useMemo(() => segments.some((s) => PICKER_ROUTES.has(s)), [segments]);
  // Sticky activation. Once the user first visits a picker-consuming
  // route, the subscriptions stay live for the rest of the flow's
  // lifetime — going back to `amount` and forward again doesn't tear
  // them down. Set-state-during-render on the same component is
  // officially supported and React resolves it before committing.
  const [enabled, setEnabled] = useState(needsPickerNow);
  if (needsPickerNow && !enabled) setEnabled(true);

  // The picker hook always runs, but with `enabled=false` it skips all
  // relay traffic / decryption / image prefetch and returns a stub
  // result. That guarantees the context is always populated, so child
  // screens that mount mid-transition never see a null context.
  const picker = useSplitBillParticipantPicker({ enabled });

  return (
    <PickerContext.Provider value={picker}>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="amount" options={AMOUNT_OPTIONS} />
        <Stack.Screen name="participants" options={PARTICIPANTS_OPTIONS} />
        <Stack.Screen name="search" options={SEARCH_OPTIONS} />
        <Stack.Screen name="summary" options={SUMMARY_OPTIONS} />
        <Stack.Screen name="detail" options={DETAIL_OPTIONS} />
      </Stack>
    </PickerContext.Provider>
  );
}
