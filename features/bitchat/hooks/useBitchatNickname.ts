import { useMemo } from 'react';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { getUsername } from '@/shared/lib/username';

/**
 * Resolves the user's display nickname for outgoing BitChat messages
 * (Nostr `n` tag, BLE advertisement name).
 *
 * Prefers the active profile's cached kind-0 `display_name` / `name`
 * (populated by the profile-metadata sync). Falls back to the
 * deterministic pubkey-seeded username used elsewhere in the app
 * (drawer, avatars) so the name matches what the user sees.
 */
export function useBitchatNickname(): string {
  const { keys } = useNostrKeysContext();
  const activeProfile = useProfileStore((s) => s.getActiveProfile());

  return useMemo(() => {
    const cached = activeProfile?.cachedDisplayName?.trim();
    if (cached) return cached;
    if (keys?.pubkey) return getUsername(keys.pubkey);
    return '';
  }, [activeProfile?.cachedDisplayName, keys?.pubkey]);
}
