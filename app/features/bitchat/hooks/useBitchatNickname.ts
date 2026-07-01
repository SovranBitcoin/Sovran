import { useMemo } from 'react';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { resolveIdentityName } from '@/shared/lib/identity';

/**
 * Resolves the user's display nickname for outgoing BitChat messages
 * (Nostr `n` tag, BLE advertisement name).
 *
 * Prefers the active profile's cached kind-0 metadata, falls back to the
 * shared deterministic word-pair via `resolveIdentityName` so the name
 * matches what the drawer / avatars / DM headers show for the same key.
 */
export function getBitchatNickname(): string {
  const activeProfile = useProfileStore.getState().getActiveProfile();
  if (!activeProfile?.pubkey) return '';
  return resolveIdentityName({
    pubkey: activeProfile.pubkey,
    overrideName: activeProfile.cachedDisplayName,
  });
}

export function useBitchatNickname(): string {
  const { keys } = useNostrKeysContext();
  const activeProfile = useProfileStore((s) => s.getActiveProfile());

  return useMemo(() => {
    if (!keys?.pubkey) return '';
    return resolveIdentityName({
      pubkey: keys.pubkey,
      overrideName: activeProfile?.cachedDisplayName,
    });
  }, [activeProfile?.cachedDisplayName, keys?.pubkey]);
}
