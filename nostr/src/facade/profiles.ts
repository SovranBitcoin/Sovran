import type { NostrTier } from '@sovranbitcoin/schemas';
import type { RequestControls } from '../timeout';
import type { ReadProvenance } from '../tiers';

// ---------------------------------------------------------------------------
// Profiles surface — batch kind-0 metadata for a set of pubkeys.
//
// Returns FULL metadata (name/displayName/picture/banner/nip05/lud16/website/
// about), keyed by pubkey. Served by Primal (`user_infos`) → raw relays
// (`{kinds:[0], authors}`). nagg's `/nostr/profiles` is minimal ({name,picture})
// so the nagg tier does NOT implement this surface — the richer tiers cover it.
// ---------------------------------------------------------------------------

// The kind-0 content parser lives with the envelope module (the one v2 parser);
// re-exported here so the tiers and the app keep importing it from the facade.
export { parseProfileMetadata, type ProfileMetadata } from '../envelope';
import { parseProfileMetadata, type ProfileMetadata } from '../envelope';

export type ProfilesRequest = RequestControls & {
  pubkeys: string[];
  refresh?: boolean;
};

export type ProfilesBundle = {
  /** pubkey → metadata (only pubkeys a tier actually resolved). */
  profiles: Record<string, ProfileMetadata>;
  /** pubkey → `created_at` (unix seconds) of the kind-0 the metadata came from, where the tier knows it. */
  createdAt?: Record<string, number>;
};

export type ResolvedProfiles = {
  tier: NostrTier;
  profiles: Record<string, ProfileMetadata>;
  createdAt?: Record<string, number>;
  /** Aggregate reads: which tiers contributed, and whether every tier has settled. */
  provenance?: ReadProvenance;
};

type Kind0Like = { pubkey?: string; kind: number; content?: string; created_at?: number };

/**
 * Reduce raw kind-0 events to the newest per pubkey, keeping its `created_at`
 * so a merge across sources can let the newest event win.
 *
 * A newest event whose content is an empty JSON object is kept as empty
 * metadata: the person cleared their profile, and that has to reach the cache
 * to remove what an older event said. Content that is not a JSON object is
 * skipped as before, so a corrupt event never hides a good older one.
 */
export function latestKind0(events: ReadonlyArray<Kind0Like>): Required<ProfilesBundle> {
  const createdAt: Record<string, number> = {};
  const profiles: Record<string, ProfileMetadata> = {};
  for (const event of events) {
    if (event.kind !== 0 || typeof event.pubkey !== 'string') continue;
    const at = typeof event.created_at === 'number' ? event.created_at : 0;
    if (event.pubkey in profiles && at <= (createdAt[event.pubkey] ?? 0)) continue;
    const content = typeof event.content === 'string' ? event.content : '';
    const metadata = parseProfileMetadata(content) ?? (isEmptyJsonObject(content) ? {} : null);
    if (!metadata) continue;
    if (at > 0) createdAt[event.pubkey] = at;
    else delete createdAt[event.pubkey];
    profiles[event.pubkey] = metadata;
  }
  return { profiles, createdAt };
}

function isEmptyJsonObject(content: string): boolean {
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/** Reduce raw kind-0 events to the latest metadata per pubkey. */
export function profilesFromKind0(events: ReadonlyArray<Kind0Like>): Record<string, ProfileMetadata> {
  return latestKind0(events).profiles;
}
