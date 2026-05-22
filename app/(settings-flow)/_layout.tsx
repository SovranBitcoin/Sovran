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
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

const INDEX_OPTIONS = { title: 'Settings' };
const ABOUT_OPTIONS = { title: 'About' };
const TERMS_OPTIONS = { title: 'Terms & Conditions' };
const PROFILE_OPTIONS = { title: 'Profile' };
const AVATAR_OPTIONS = { title: 'Avatar Fallback' };
const ROUTING_OPTIONS = { title: 'Swap Routing' };
const KEYRING_OPTIONS = { title: 'P2PK Keys' };
const STORAGE_OPTIONS = { title: 'Storage Inventory' };
const DESIGN_SYSTEM_OPTIONS = { title: 'Design System' };
const RECOVERY_OPTIONS = { title: 'Recover Wallet' };
const DELETE_OPTIONS = { title: 'Delete Account' };

export default function SettingsFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }),
    [foreground, background]
  );

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={INDEX_OPTIONS} />
      <Stack.Screen name="about" options={ABOUT_OPTIONS} />
      <Stack.Screen name="terms" options={TERMS_OPTIONS} />
      <Stack.Screen name="profile" options={PROFILE_OPTIONS} />
      <Stack.Screen name="avatar" options={AVATAR_OPTIONS} />
      <Stack.Screen name="routing" options={ROUTING_OPTIONS} />
      <Stack.Screen name="keyring" options={KEYRING_OPTIONS} />
      <Stack.Screen name="storage" options={STORAGE_OPTIONS} />
      <Stack.Screen name="design-system" options={DESIGN_SYSTEM_OPTIONS} />
      <Stack.Screen name="recovery" options={RECOVERY_OPTIONS} />
      <Stack.Screen name="delete" options={DELETE_OPTIONS} />
    </Stack>
  );
}
