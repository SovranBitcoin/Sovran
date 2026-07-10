/**
 * @fileoverview Settings Flow Modal Layout
 *
 * Nested stack inside a modal presentation, same pattern as receive-flow.
 * Parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within push horizontally with close/back header.
 */

import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import {
  androidHeaderScrimOptions,
  createFlowLayoutScreenOptions,
} from '../../config/flowLayoutOptions';

const INDEX_OPTIONS = { title: 'Settings' };
const ABOUT_OPTIONS = { title: 'About' };
const PROFILE_OPTIONS = { title: 'Profile' };
const AVATAR_OPTIONS = { title: 'Avatar fallback' };
const NOTIFICATION_POLICY_OPTIONS = { title: 'Notifications' };
const ROUTING_OPTIONS = { title: 'Swap routing' };
const NETWORK_OPTIONS = { title: 'Network' };
const KEYRING_OPTIONS = { title: 'P2PK Keys' };
const STORAGE_OPTIONS = { title: 'Storage inventory' };
const MEDIA_OPTIONS = { title: 'My media' };
const DESIGN_SYSTEM_OPTIONS = { title: 'Design system' };
const DESIGN_SYSTEM_FOUNDATIONS_OPTIONS = { title: 'Foundations' };
const DESIGN_SYSTEM_WALLET_CONTROLS_OPTIONS = { title: 'Wallet controls' };
const DESIGN_SYSTEM_LOADING_OPTIONS = { title: 'Loading indicator' };
const DESIGN_SYSTEM_SEGMENTED_OPTIONS = { title: 'Segmented progress' };
const DESIGN_SYSTEM_TIMELINE_OPTIONS = { title: 'Timeline' };
const DESIGN_SYSTEM_EMPTY_STATES_OPTIONS = { title: 'Empty states' };
const DESIGN_SYSTEM_SKELETON_CROSSFADE_OPTIONS = { title: 'Skeleton crossfade' };
const DESIGN_SYSTEM_FADE_STRESS_OPTIONS = { title: 'Fade-reveal stress' };
const RECOVERY_OPTIONS = { title: 'Recover wallet' };
const DELETE_OPTIONS = { title: 'Delete account' };

export default function SettingsFlowLayout() {
  const [foreground, background, surface] = useThemeColor([
    'foreground',
    'background',
    'surface',
  ] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }),
    [foreground, background]
  );
  // TermsAndConditionsScreen paints its canvas `surface`. This is a native-header
  // flow (no androidSheet), so the scrim color comes from androidHeaderScrimOptions,
  // not headerStyle — override it to `surface` so the Android header gradient fades
  // from the page color, not the darker theme `background`. (Same pattern as
  // user-flow `thread`.) contentStyle keeps the slide-in background consistent.
  const termsOptions = useMemo(
    () => ({
      title: 'Terms & conditions',
      contentStyle: { backgroundColor: surface },
      ...androidHeaderScrimOptions(surface),
    }),
    [surface]
  );

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={INDEX_OPTIONS} />
      <Stack.Screen name="about" options={ABOUT_OPTIONS} />
      <Stack.Screen name="terms" options={termsOptions} />
      <Stack.Screen name="profile" options={PROFILE_OPTIONS} />
      <Stack.Screen name="avatar" options={AVATAR_OPTIONS} />
      <Stack.Screen name="notification-policy" options={NOTIFICATION_POLICY_OPTIONS} />
      <Stack.Screen name="routing" options={ROUTING_OPTIONS} />
      <Stack.Screen name="network" options={NETWORK_OPTIONS} />
      <Stack.Screen name="keyring" options={KEYRING_OPTIONS} />
      <Stack.Screen name="storage" options={STORAGE_OPTIONS} />
      <Stack.Screen name="media" options={MEDIA_OPTIONS} />
      <Stack.Screen name="design-system" options={DESIGN_SYSTEM_OPTIONS} />
      <Stack.Screen name="design-system-foundations" options={DESIGN_SYSTEM_FOUNDATIONS_OPTIONS} />
      <Stack.Screen
        name="design-system-wallet-controls"
        options={DESIGN_SYSTEM_WALLET_CONTROLS_OPTIONS}
      />
      <Stack.Screen name="design-system-loading" options={DESIGN_SYSTEM_LOADING_OPTIONS} />
      <Stack.Screen name="design-system-segmented" options={DESIGN_SYSTEM_SEGMENTED_OPTIONS} />
      <Stack.Screen name="design-system-timeline" options={DESIGN_SYSTEM_TIMELINE_OPTIONS} />
      <Stack.Screen
        name="design-system-empty-states"
        options={DESIGN_SYSTEM_EMPTY_STATES_OPTIONS}
      />
      <Stack.Screen
        name="design-system-skeleton-crossfade"
        options={DESIGN_SYSTEM_SKELETON_CROSSFADE_OPTIONS}
      />
      <Stack.Screen name="design-system-fade-stress" options={DESIGN_SYSTEM_FADE_STRESS_OPTIONS} />
      <Stack.Screen name="recovery" options={RECOVERY_OPTIONS} />
      <Stack.Screen name="delete" options={DELETE_OPTIONS} />
    </Stack>
  );
}
