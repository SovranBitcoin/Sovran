/**
 * @fileoverview Profile Flow Modal Layout
 *
 * Dedicated root modal stack for Nostr profiles opened from scanner or
 * already-modal contexts. The existing `(user-flow)` stays as the flat
 * side-slide profile stack used by Contacts, Feed, and similar surfaces.
 */

import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

const PROFILE_OPTIONS = { title: 'Profile' };
const USER_MESSAGES_OPTIONS = { headerShown: false };
const SHARE_OPTIONS = { title: 'Share profile' };
const THREAD_OPTIONS = { title: 'Thread' };
const WHITENOISE_SETUP_OPTIONS = { title: 'White Noise' };
const WHITENOISE_DM_OPTIONS = { headerShown: false };
const BITCHAT_NETWORK_OPTIONS = { headerShown: false };
const BITCHAT_DM_OPTIONS = { headerShown: false };

export default function ProfileFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }),
    [foreground, background]
  );

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="profile" options={PROFILE_OPTIONS} />
      <Stack.Screen name="userMessages" options={USER_MESSAGES_OPTIONS} />
      <Stack.Screen name="share" options={SHARE_OPTIONS} />
      <Stack.Screen name="thread" options={THREAD_OPTIONS} />
      <Stack.Screen name="whitenoiseSetup" options={WHITENOISE_SETUP_OPTIONS} />
      <Stack.Screen name="whitenoiseDM" options={WHITENOISE_DM_OPTIONS} />
      <Stack.Screen name="bitchatNetwork" options={BITCHAT_NETWORK_OPTIONS} />
      <Stack.Screen name="bitchatDM" options={BITCHAT_DM_OPTIONS} />
    </Stack>
  );
}
