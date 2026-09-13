import { useOwnProfileMetadataStore } from '@/shared/stores/profile/ownProfileMetadataStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { PUBLIC_DEMO_METADATA } from '@/shared/stores/runtime/mockPublicProfile';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { resolveIdentityName } from '@/shared/lib/identity';

/**
 * Returns the best available display name and picture for one of the
 * user's *own* account pubkeys (i.e. an entry in `profileStore`). Reads
 * the locally-cached Nostr metadata (no relay fetch) and falls through
 * to the deterministic word pair via `resolveIdentityName`. For foreign
 * pubkeys use `useIdentityName` instead — it consults the SWR-backed
 * `nostrMetadataCache`. In presentation Mock Mode, the reviewed public snapshot
 * can supply display metadata without creating an account or changing keys.
 */
export function useProfileDisplay(pubkey: string): { displayName: string; picture?: string } {
  const profile = useProfileStore((s) => s.profiles.find((p) => p.pubkey === pubkey));
  const isOwn = useProfileStore(
    (s) =>
      s.profiles.find((profile) => profile.accountIndex === s.activeAccountIndex)?.pubkey === pubkey
  );
  const optimistic = useOwnProfileMetadataStore((s) => (isOwn ? s.optimistic : null));
  const mockMode = useSettingsStore((s) => s.mockMode);
  const demo = mockMode ? PUBLIC_DEMO_METADATA.get(pubkey) : undefined;
  const displayName = resolveIdentityName({
    pubkey,
    overrideName:
      optimistic?.name ?? (demo?.displayName || demo?.name || profile?.cachedDisplayName),
  });
  return {
    displayName,
    picture:
      optimistic?.picture !== undefined
        ? (optimistic.picture ?? undefined)
        : (demo?.picture ?? profile?.cachedPicture),
  };
}
