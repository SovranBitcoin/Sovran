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

import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import {
  androidHeaderScrimOptions,
  createFlowLayoutScreenOptions,
} from '../../config/flowLayoutOptions';

const PROFILE_OPTIONS = { title: 'Profile' };
const USER_MESSAGES_OPTIONS = { headerShown: false };
const SHARE_OPTIONS = { title: 'Share profile' };
const GEOHASH_CHAT_OPTIONS = { headerShown: false };
const BITCHAT_NETWORK_OPTIONS = { headerShown: false };
const BITCHAT_DM_OPTIONS = { headerShown: false };

export default function UserFlowLayout() {
  const [foreground, background, surface] = useThemeColor([
    'foreground',
    'background',
    'surface',
  ] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }),
    [foreground, background]
  );
  const threadOptions = useMemo(
    () => ({
      title: 'Thread',
      contentStyle: { backgroundColor: surface },
      ...androidHeaderScrimOptions(surface),
    }),
    [surface]
  );

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="profile" options={PROFILE_OPTIONS} />
      <Stack.Screen name="userMessages" options={USER_MESSAGES_OPTIONS} />
      <Stack.Screen name="share" options={SHARE_OPTIONS} />
      <Stack.Screen name="thread" options={threadOptions} />
      <Stack.Screen name="geohashChat" options={GEOHASH_CHAT_OPTIONS} />
      <Stack.Screen name="bitchatNetwork" options={BITCHAT_NETWORK_OPTIONS} />
      <Stack.Screen name="bitchatDM" options={BITCHAT_DM_OPTIONS} />
    </Stack>
  );
}
