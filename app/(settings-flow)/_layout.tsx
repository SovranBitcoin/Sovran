/**
 * @fileoverview Settings Flow Modal Layout
 *
 * Nested stack inside a modal presentation, same pattern as receive-flow.
 * Parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within push horizontally with close/back header.
 */

import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

export default function SettingsFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  return (
    <Stack screenOptions={createFlowLayoutScreenOptions({ foreground, background })}>
      <Stack.Screen name="index" options={{ title: 'Settings' }} />
      <Stack.Screen name="about" options={{ title: 'About' }} />
      <Stack.Screen name="terms" options={{ title: 'Terms & Conditions' }} />
      <Stack.Screen name="passcode" options={{ title: 'Passcode' }} />
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
      <Stack.Screen name="theme" options={{ title: 'Theme' }} />
      <Stack.Screen name="routing" options={{ title: 'Swap Routing' }} />
      <Stack.Screen name="keyring" options={{ title: 'P2PK Keys' }} />
      <Stack.Screen name="storage" options={{ title: 'Storage Inventory' }} />
      <Stack.Screen name="recovery" options={{ title: 'Recover Wallet' }} />
      <Stack.Screen name="delete" options={{ title: 'Delete Account' }} />
      <Stack.Screen name="wallpapers" options={{ title: 'Wallpapers' }} />
      <Stack.Screen name="wallpaper-album" options={{ title: '' }} />
      <Stack.Screen name="wallpaper-preview" options={{ title: '', headerShown: false }} />
    </Stack>
  );
}
