/**
 * @fileoverview Mint Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within this group push horizontally:
 * - list: Entry point, shows owned mints with balances
 * - add: Discover and add new mints (horizontal push)
 * - info: Mint details and audit info (horizontal push)
 *
 * The first screen shows a close button, subsequent screens show a back button.
 */

import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';
import { AndroidSheetRoot } from '@/shared/ui/composed/AndroidSheetRoot';
import { FLOW_SHEET_HEADER_HEIGHT } from '@/shared/ui/composed/FlowSheetHeader';

const LIST_OPTIONS = { title: 'Select mint' };
const ADD_OPTIONS = { title: 'Add mints' };
const INFO_OPTIONS = { title: 'Mint details' };
const REVIEWS_OPTIONS = { title: 'Reviews' };
const DISTRIBUTION_OPTIONS = { title: 'Balance split' };
const REBALANCE_PLAN_OPTIONS = { title: 'Rebalance plan' };
// Statically shown: DmChatHeader swaps header content only. A false→true
// visibility flip on mount remounts the screen in a loop inside modals
// (blank DM thread) — keep in sync with config/modalScreens.ts.
const USER_MESSAGES_OPTIONS = { headerShown: true };

export default function MintFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }, { androidSheet: true }),
    [foreground, background]
  );

  return (
    <AndroidSheetRoot headerHeight={FLOW_SHEET_HEADER_HEIGHT}>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="list" options={LIST_OPTIONS} />
        <Stack.Screen name="add" options={ADD_OPTIONS} />
        <Stack.Screen name="info" options={INFO_OPTIONS} />
        <Stack.Screen name="reviews" options={REVIEWS_OPTIONS} />
        <Stack.Screen name="distribution" options={DISTRIBUTION_OPTIONS} />
        <Stack.Screen name="rebalancePlan" options={REBALANCE_PLAN_OPTIONS} />
        <Stack.Screen name="userMessages" options={USER_MESSAGES_OPTIONS} />
      </Stack>
    </AndroidSheetRoot>
  );
}
