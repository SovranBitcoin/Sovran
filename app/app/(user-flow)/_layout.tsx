/**
 * @fileoverview User Flow Layout
 *
 * A nested stack navigator. The root Stack presents this group as a pushed page
 * (`slideFromRight('(user-flow)')` in config/modalScreens.ts).
 * Screens within this group push horizontally:
 * - profile: Entry point, shows user profile info
 * - userMessages: Chat with user (horizontal push)
 * - share: Share user's npub via QR (horizontal push)
 *
 * The first screen shows a close button, subsequent screens show a back button.
 */

import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

const PROFILE_OPTIONS = { title: 'Profile' };
const SHARE_OPTIONS = { title: 'Share profile' };
const HIDDEN_HEADER_OPTIONS = { headerShown: false };

export default function UserFlowLayout() {
  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background: surface }),
    [foreground, surface]
  );
  const threadOptions = useMemo(
    () => ({
      title: 'Thread',
      contentStyle: { backgroundColor: surface },
    }),
    [surface]
  );

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="profile" options={PROFILE_OPTIONS} />
      <Stack.Screen name="share" options={SHARE_OPTIONS} />
      <Stack.Screen name="thread" options={threadOptions} />
      <Stack.Screen name="geohashChat" options={HIDDEN_HEADER_OPTIONS} />
      <Stack.Screen name="bitchatNetwork" options={HIDDEN_HEADER_OPTIONS} />
      <Stack.Screen name="bitchatDM" options={HIDDEN_HEADER_OPTIONS} />
    </Stack>
  );
}
