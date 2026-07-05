import type { NostrTier } from '@sovranbitcoin/schemas';
import type { RequestControls } from '../timeout';
import type { TierOutcome } from '../tiers';

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
};

export type ResolvedProfiles = {
  tier: NostrTier;
  profiles: Record<string, ProfileMetadata>;
};

export interface ProfilesTier {
  readonly tier: NostrTier;
  getProfiles(request: ProfilesRequest): Promise<TierOutcome<ProfilesBundle>>;
}

/** Reduce raw kind-0 events to the latest metadata per pubkey. */
export function profilesFromKind0(
  events: ReadonlyArray<{ pubkey?: string; kind: number; content?: string; created_at?: number }>,
): Record<string, ProfileMetadata> {
  const latestAt: Record<string, number> = {};
  const out: Record<string, ProfileMetadata> = {};
  for (const event of events) {
    if (event.kind !== 0 || typeof event.pubkey !== 'string') continue;
    const at = typeof event.created_at === 'number' ? event.created_at : 0;
    if (event.pubkey in latestAt && at <= latestAt[event.pubkey]) continue;
    const metadata = parseProfileMetadata(typeof event.content === 'string' ? event.content : '');
    if (!metadata) continue;
    latestAt[event.pubkey] = at;
    out[event.pubkey] = metadata;
  }
  return out;
}
