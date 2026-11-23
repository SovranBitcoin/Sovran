/**
 * @fileoverview Profile Flow Modal Layout
 *
 * Dedicated root modal stack for Nostr profiles opened from scanner or
 * already-modal contexts. The existing `(user-flow)` stays as the flat
 * side-slide profile stack used by Contacts, Feed, and similar surfaces.
 */

import { Stack } from 'expo-router';
import { AndroidSheetFlowStack } from '../../config/flowLayoutOptions';

const PROFILE_OPTIONS = { title: 'Profile' };
const SHARE_OPTIONS = { title: 'Share profile' };
const THREAD_OPTIONS = { title: 'Thread' };
const HIDDEN_HEADER_OPTIONS = { headerShown: false };

export default function ProfileFlowLayout() {
  return (
    <AndroidSheetFlowStack flow="(profile-flow)">
      <Stack.Screen name="profile" options={PROFILE_OPTIONS} />
      <Stack.Screen name="share" options={SHARE_OPTIONS} />
      <Stack.Screen name="thread" options={THREAD_OPTIONS} />
      <Stack.Screen name="bitchatNetwork" options={HIDDEN_HEADER_OPTIONS} />
      <Stack.Screen name="bitchatDM" options={HIDDEN_HEADER_OPTIONS} />
    </AndroidSheetFlowStack>
  );
}
