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
import { useTheme } from 'providers/ThemeProvider';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

export default function UserFlowLayout() {
  const { getPrimaryColor } = useTheme();

  return (
    <Stack screenOptions={createFlowLayoutScreenOptions(getPrimaryColor)}>
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
      <Stack.Screen name="userMessages" options={{ headerShown: false }} />
      <Stack.Screen name="share" options={{ title: 'Share Profile' }} />
      <Stack.Screen name="thread" options={{ title: 'Thread' }} />
    </Stack>
  );
}
