/**
 * @fileoverview Signer Flow Layout
 *
 * Nested stack for the Nostr Signer pages, same pattern as settings-flow.
 * The root Stack presents this group with a horizontal slide
 * (`slideFromRight('(signer-flow)')` in config/modalScreens.ts); screens
 * within push horizontally with close/back header.
 *
 * Titles: static ones live here; the per-app permission editor (`app`) owns
 * its header inside the screen (scroll-linked identity crossfade), and
 * `share` sets its own title via `useScreenOptions` inside ShareSignerScreen.
 *
 * Headers are transparent; on iOS 26 the system scroll-edge glass frosts
 * them automatically once content scrolls underneath (the thread-page look —
 * deliberately NO `headerBlurEffect`, which would overlap the system effect
 * per the react-native-screens docs). Screens make content underlap by
 * padding scroll content with `useHeaderHeight()` instead of `safeArea`.
 */

import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

const INDEX_OPTIONS = { title: 'Remote Login' };
const REQUESTS_OPTIONS = { title: 'Pending Requests' };
const ACTIVITY_OPTIONS = { title: 'Activity' };
const ACTIVITY_DETAIL_OPTIONS = { title: 'Request Details' };
// Dynamic app-name title is set by app/(signer-flow)/app.tsx via <Stack.Screen>.
const APP_OPTIONS = { title: '' };
const APP_PERMISSIONS_OPTIONS = { title: 'Permissions' };
const APP_PERSON_OPTIONS = { title: 'Decrypt Access' };
const SHARE_OPTIONS = { title: 'Share Remote Login' };
const CONNECT_OPTIONS = { title: 'Connect App' };

export default function SignerFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }),
    [foreground, background]
  );

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={INDEX_OPTIONS} />
      <Stack.Screen name="requests" options={REQUESTS_OPTIONS} />
      <Stack.Screen name="activity" options={ACTIVITY_OPTIONS} />
      <Stack.Screen name="activity-detail" options={ACTIVITY_DETAIL_OPTIONS} />
      <Stack.Screen name="app" options={APP_OPTIONS} />
      <Stack.Screen name="app-permissions" options={APP_PERMISSIONS_OPTIONS} />
      <Stack.Screen name="app-person" options={APP_PERSON_OPTIONS} />
      <Stack.Screen name="share" options={SHARE_OPTIONS} />
      <Stack.Screen name="connect" options={CONNECT_OPTIONS} />
    </Stack>
  );
}
