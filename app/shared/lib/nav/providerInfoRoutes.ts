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
