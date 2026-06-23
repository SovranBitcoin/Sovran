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

/**
 * Fetch one profile's header (kind-0 metadata + follow/follower/note counts +
 * joined date) through the tier-selecting facade. Primal serves it via
 * `user_profile`; the relay floor derives metadata + following-count. Returns
 * null when every tier is disabled/exhausted. Reputation is NOT here — it's
 * nagg-only and stays on the REST path.
 */
export async function fetchProfileStatsViaFacade(
  pubkey: string,
  options: { viewerPubkey?: string; signal?: AbortSignal } = {}
): Promise<facade.ResolvedProfileStats | null> {
  const layer = buildNostrDataLayer();
  if (!layer) return null;
  const result = await layer.getProfileStats({
    pubkey,
    ...(options.viewerPubkey ? { viewerPubkey: options.viewerPubkey } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return result.match(
    (resolved) => resolved,
    () => null
  );
}
