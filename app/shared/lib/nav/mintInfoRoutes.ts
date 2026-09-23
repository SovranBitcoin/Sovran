type MintInfoHref = {
  pathname: '/(mint-flow)/info';
  params: {
    mintInfoEntry: string;
  };
};

/**
 * What the CALLER already has on screen. Passing it through means the mint page
 * paints the name, icon and score on its first frame instead of skeletoning
 * them while a NUT-06 round-trip it has already effectively made repeats.
 *
 * Deliberately under `seed*` keys rather than the canonical `displayName` /
 * `iconUrl` / `kymScore`: the screen-actions bridge triggers its mint-info
 * fetch on `!current.displayName`, so seeding the canonical key would suppress
 * the fetch and the page would never get `contact`, `description`, `motd` or
 * the trust flag. The seed is a first paint, not a replacement for the read.
 */
// Not exported: callers pass an object literal and TypeScript checks it
// structurally, so naming the type at a call site would be ceremony.
type MintInfoSeed = {
  /** The mint's name as the caller is already displaying it. */
  displayName?: string;
  iconUrl?: string;
  /** KYM review score, 0–5. */
  kymScore?: number;
  reviewCount?: number;
};

export function getProfileMintInfoUrl(
  profileMintUrl: unknown,
  routeMintUrl: string | undefined
): string | undefined {
  if (typeof profileMintUrl === 'string' && profileMintUrl.length > 0) {
    return profileMintUrl;
  }
  return routeMintUrl;
}

export function buildMintInfoHref(mintUrl: string, seed?: MintInfoSeed): MintInfoHref {
  return {
    pathname: '/(mint-flow)/info',
    params: {
      // Undefined seed fields are dropped by JSON.stringify, so a caller with
      // nothing to offer produces the same `{ mintUrl }` payload as before.
      mintInfoEntry: JSON.stringify({
        mintUrl,
        seedDisplayName: seed?.displayName,
        seedIconUrl: seed?.iconUrl,
        seedKymScore: seed?.kymScore,
        seedReviewCount: seed?.reviewCount,
      }),
    },
  };
}
