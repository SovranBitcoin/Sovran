import type { facade } from '@sovranbitcoin/nagg-ts';

import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';

type ProfileMetadata = facade.ProfileMetadata;

/**
 * Fetch kind-0 metadata for a set of pubkeys through the tier-selecting facade
 * (Primal `user_infos` → raw relays). Returns pubkey → metadata for the ones a
 * tier resolved; never throws. Empty when every tier is disabled or exhausted.
 */
export async function fetchProfilesViaFacade(
  pubkeys: string[]
): Promise<Record<string, ProfileMetadata>> {
  if (pubkeys.length === 0) return {};
  const layer = buildNostrDataLayer();
  if (!layer) return {};
  const result = await layer.getProfiles({ pubkeys });
  return result.match(
    (resolved) => resolved.profiles,
    () => ({})
  );
}
