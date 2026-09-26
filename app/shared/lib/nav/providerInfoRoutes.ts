/**
 * Href builder for the provider details screen.
 *
 * Mirrors `mintInfoRoutes.ts`: one JSON-encoded param, and a `seed` prefix on
 * anything the screen will re-fetch. The prefix is load-bearing there because
 * the screen triggers its fetch on a missing canonical field, so seeding the
 * canonical key would suppress the read. Same rule here.
 */
interface ProviderInfoSeed {
  seedName?: string;
  /** What the row already knew, so the page paints it on the first frame
   *  instead of skeletoning a fact the user can see on the row behind it. */
  seedDescription?: string;
  /** The operator's hex pubkey. The Operator section mounts at once. */
  seedPubkey?: string;
  /** Accepted mints, so the list reserves the right number of rows. */
  seedMints?: readonly string[];
  /** nagg's follower count for the operator. */
  seedFollowers?: number;
  /** nagg's catalog counts for the row. Together they decide the privacy
   *  verdict, so the notice paints on the first frame instead of after the
   *  catalog read. */
  seedModelCount?: number;
  seedEncryptedModelCount?: number;
}

export function buildProviderInfoHref(
  nodeBaseUrl: string,
  seed: ProviderInfoSeed = {}
): { pathname: '/(ai-flow)/provider'; params: { providerInfoEntry: string } } {
  return {
    pathname: '/(ai-flow)/provider',
    params: { providerInfoEntry: JSON.stringify({ nodeBaseUrl, ...seed }) },
  };
}
