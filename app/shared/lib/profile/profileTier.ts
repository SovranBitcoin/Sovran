/**
 * Profile tier ladder — the ring drawn around a profile's avatar.
 *
 * A game-style ladder rather than a score readout: most accounts sit on the
 * lower rungs, each rung is roughly 4–5× harder than the last, and the top
 * rungs are rare. Two signals feed it and the HIGHER rung wins:
 *
 * - follower count (every profile has one once Primal fills it), and
 * - the Vertex pagerank score (0–100, a saturating transform of pagerank that
 *   nagg only computes for pubkeys with ≥ 500 followers — so it can promote a
 *   well-connected account above its raw follower rung, never demote one).
 *
 * A profile whose first known event is younger than `NEW_PROFILE_MAX_AGE_SEC`
 * is `new` regardless of counts; an account nothing is known about has no tier
 * (`null`), never a guessed one.
 */

export type ProfileTier = 'new' | 'iron' | 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';

type RankedTier = Exclude<ProfileTier, 'new'>;

/** Lowest → highest. */
export const PROFILE_TIER_LADDER: readonly RankedTier[] = [
  'iron',
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
];

export const NEW_PROFILE_MAX_AGE_SEC = 30 * 24 * 60 * 60;

/** Minimum follower count per rung. */
const PROFILE_TIER_FOLLOWER_FLOORS: Record<RankedTier, number> = {
  iron: 0,
  bronze: 50,
  silver: 300,
  gold: 1_500,
  platinum: 6_000,
  diamond: 25_000,
};

/**
 * Minimum Vertex score per rung. Score ≈ 65 is ~5× the average pagerank,
 * 80 ≈ 15×, 92 ≈ 200× — a score can only exist above 500 followers, so the
 * lower rungs have no score floor.
 */
const PROFILE_TIER_SCORE_FLOORS: Partial<Record<RankedTier, number>> = {
  gold: 65,
  platinum: 80,
  diamond: 92,
};

export const PROFILE_TIER_LABEL: Record<ProfileTier, string> = {
  new: 'NEW',
  iron: 'IRON',
  bronze: 'BRONZE',
  silver: 'SILVER',
  gold: 'GOLD',
  platinum: 'PLATINUM',
  diamond: 'DIAMOND',
};

function highestRung(
  value: number | undefined,
  floors: Partial<Record<RankedTier, number>>
): RankedTier | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  let best: RankedTier | null = null;
  for (const tier of PROFILE_TIER_LADDER) {
    const floor = floors[tier];
    if (floor !== undefined && value >= floor) best = tier;
  }
  return best;
}

export function resolveProfileTier(input: {
  followers?: number;
  /** Vertex score, 0–100. */
  score?: number;
  /** Unix seconds of the profile's first known event. */
  firstEventAt?: number | null;
  nowSec: number;
}): ProfileTier | null {
  const { followers, score, firstEventAt, nowSec } = input;
  if (
    typeof firstEventAt === 'number' &&
    firstEventAt > 0 &&
    nowSec - firstEventAt < NEW_PROFILE_MAX_AGE_SEC
  ) {
    return 'new';
  }
  const byFollowers = highestRung(followers, PROFILE_TIER_FOLLOWER_FLOORS);
  const byScore = highestRung(score, PROFILE_TIER_SCORE_FLOORS);
  if (!byFollowers && !byScore) return null;
  if (!byFollowers) return byScore;
  if (!byScore) return byFollowers;
  return PROFILE_TIER_LADDER.indexOf(byScore) > PROFILE_TIER_LADDER.indexOf(byFollowers)
    ? byScore
    : byFollowers;
}
