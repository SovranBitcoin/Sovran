import { useProfileStore } from '@/stores/profileStore';
import { getUsername } from '@/helper/username';

/**
 * Returns the best available display name and picture for a pubkey,
 * preferring cached Nostr kind-0 metadata over the deterministic fallback.
 */
export function useProfileDisplay(pubkey: string): { displayName: string; picture?: string } {
  const profile = useProfileStore((s) => s.profiles.find((p) => p.pubkey === pubkey));
  return {
    displayName: profile?.cachedDisplayName || getUsername(pubkey),
    picture: profile?.cachedPicture,
  };
}
