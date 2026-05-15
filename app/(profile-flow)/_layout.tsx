/**
 * @fileoverview Profile Flow Modal Layout
 *
 * Dedicated root modal stack for Nostr profiles opened from scanner or
 * already-modal contexts. The existing `(user-flow)` stays as the flat
 * side-slide profile stack used by Contacts, Feed, and similar surfaces.
 */

import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

export default function ProfileFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  return (
    <Stack screenOptions={createFlowLayoutScreenOptions({ foreground, background })}>
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
      <Stack.Screen name="userMessages" options={{ headerShown: false }} />
      <Stack.Screen name="share" options={{ title: 'Share Profile' }} />
      <Stack.Screen name="thread" options={{ title: 'Thread' }} />
      <Stack.Screen name="whitenoiseSetup" options={{ title: 'White Noise' }} />
      <Stack.Screen name="whitenoiseDM" options={{ headerShown: false }} />
      <Stack.Screen name="bitchatNetwork" options={{ headerShown: false }} />
      <Stack.Screen name="bitchatDM" options={{ headerShown: false }} />
    </Stack>
  );
}
