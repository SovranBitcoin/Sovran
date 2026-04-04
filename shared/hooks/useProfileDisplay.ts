import { useProfileStore } from '@/shared/stores/global/profileStore';
import { getUsername } from '@/shared/lib/username';
import { log } from '@/shared/lib/logger';

/**
 * Returns the best available display name and picture for a pubkey,
 * preferring cached Nostr kind-0 metadata over the deterministic fallback.
 */
export function useProfileDisplay(pubkey: string): { displayName: string; picture?: string } {
  const profile = useProfileStore((s) => s.profiles.find((p) => p.pubkey === pubkey));
  const source = profile?.cachedDisplayName ? 'nostr' : 'fallback';
  const displayName = profile?.cachedDisplayName || getUsername(pubkey);

  log.debug('profile.resolve', { pubkey: pubkey.slice(0, 8), source, hasPicture: !!profile?.cachedPicture });

  return { displayName, picture: profile?.cachedPicture };
}
