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

const LIST_OPTIONS = { title: 'Select Mint' };
const ADD_OPTIONS = { title: 'Add Mints' };
const INFO_OPTIONS = { title: 'Mint Details' };
const REVIEWS_OPTIONS = { title: 'Reviews' };
const DISTRIBUTION_OPTIONS = { title: 'Balance split' };
const REBALANCE_PLAN_OPTIONS = { title: 'Rebalance Plan' };
const USER_MESSAGES_OPTIONS = { headerShown: false };

export default function MintFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }),
    [foreground, background]
  );

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="list" options={LIST_OPTIONS} />
      <Stack.Screen name="add" options={ADD_OPTIONS} />
      <Stack.Screen name="info" options={INFO_OPTIONS} />
      <Stack.Screen name="reviews" options={REVIEWS_OPTIONS} />
      <Stack.Screen name="distribution" options={DISTRIBUTION_OPTIONS} />
      <Stack.Screen name="rebalancePlan" options={REBALANCE_PLAN_OPTIONS} />
      <Stack.Screen name="userMessages" options={USER_MESSAGES_OPTIONS} />
    </Stack>
  );
}
