/** Matches Numo's onboarding/runtime defaults, reviewed 2026-09-10.
 * https://github.com/cashubtc/numo/blob/199add3c882f88bf61fa4ea31530df28e4b5ee76/app/src/main/java/com/electricdreams/numo/core/util/MintManager.kt#L33-L42
 * These are starting choices, not a guarantee of backing or availability.
 */
export const DEFAULT_MINT_URLS = [
  'https://mint.minibits.cash/Bitcoin',
  'https://mint.macadamia.cash',
  'https://antifiat.cash',
  'https://mint.cubabitcoin.org',
] as const;

export const DEFAULT_MINT_URL = DEFAULT_MINT_URLS[0];
