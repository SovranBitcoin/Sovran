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

export type ProfileMetadata = {
  name?: string;
  displayName?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
  about?: string;
};

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

/**
 * Parse a kind-0 event's `content` JSON into ProfileMetadata. Tolerant: unknown
 * fields ignored, `display_name`/`displayName` both accepted, null on bad JSON.
 */
export function parseProfileMetadata(content: string): ProfileMetadata | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null) return null;
  const o = json as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const metadata: ProfileMetadata = {
    name: str(o.name),
    displayName: str(o.display_name) ?? str(o.displayName),
    picture: str(o.picture),
    banner: str(o.banner),
    nip05: str(o.nip05),
    lud16: str(o.lud16),
    website: str(o.website),
    about: str(o.about),
  };
  // Drop a profile that carried nothing useful.
  return Object.values(metadata).some((v) => v !== undefined) ? metadata : null;
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
