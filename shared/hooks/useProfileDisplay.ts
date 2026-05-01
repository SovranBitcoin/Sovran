import { useProfileStore } from '@/shared/stores/global/profileStore';
import { resolveIdentityName } from '@/shared/lib/identity';

/**
 * Returns the best available display name and picture for one of the
 * user's *own* account pubkeys (i.e. an entry in `profileStore`). Reads
 * the locally-cached Nostr metadata (no relay fetch) and falls through
 * to the deterministic word pair via `resolveIdentityName`. For foreign
 * pubkeys use `useIdentityName` instead — it consults the SWR-backed
 * `nostrMetadataCache`.
 */
export function useProfileDisplay(pubkey: string): { displayName: string; picture?: string } {
  const profile = useProfileStore((s) => s.profiles.find((p) => p.pubkey === pubkey));
  const displayName = resolveIdentityName({
    pubkey,
    overrideName: profile?.cachedDisplayName,
  });
  return { displayName, picture: profile?.cachedPicture };
}
