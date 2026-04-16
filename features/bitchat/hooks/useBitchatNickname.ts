import { useMemo } from 'react';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useProfileStore } from '@/shared/stores/global/profileStore';

/**
 * Resolves the user's display nickname for outgoing BitChat messages
 * (Nostr `n` tag, BLE advertisement name).
 *
 * Prefers the active profile's cached kind-0 `display_name` / `name`
 * (populated by the profile-metadata sync). Falls back to a 12-char
 * npub prefix so we never broadcast an empty nickname.
 */
export function useBitchatNickname(): string {
  const { keys } = useNostrKeysContext();
  const activeProfile = useProfileStore((s) => s.getActiveProfile());

  return useMemo(() => {
    const cached = activeProfile?.cachedDisplayName?.trim();
    if (cached) return cached;
    if (keys?.npub) return keys.npub.slice(0, 12);
    return '';
  }, [activeProfile?.cachedDisplayName, keys?.npub]);
}
