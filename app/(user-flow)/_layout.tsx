/**
 * @fileoverview User Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within this group push horizontally:
 * - profile: Entry point, shows user profile info
 * - userMessages: Chat with user (horizontal push)
 * - share: Share user's npub via QR (horizontal push)
 *
 * The first screen shows a close button, subsequent screens show a back button.
 */

import { Stack } from 'expo-router';
import { useThemeColor } from '@/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

export default function UserFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  return (
    <Stack screenOptions={createFlowLayoutScreenOptions({ foreground, background })}>
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
      <Stack.Screen name="userMessages" options={{ headerShown: false }} />
      <Stack.Screen name="share" options={{ title: 'Share Profile' }} />
      <Stack.Screen name="thread" options={{ title: 'Thread' }} />
    </Stack>
  );
}
