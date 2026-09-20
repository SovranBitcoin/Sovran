/**
 * Nagg mint-discovery rows as the mint search screen consumes them: the mapping
 * from a `/nostr/mint/discover` row to the screen's `MintSearchResult` shape,
 * and the client-side query / currency / receive-method filters applied to the
 * discovered set (discovery is one call, so filtering never hits the network).
 */
import { toAccountUnit } from 'wallet';

import type { DiscoverMint, MintSearchResult } from '@/shared/lib/apiClient';
import { mintMethodsFromNuts, mintMethodUnitPairsFromNuts } from '@/shared/lib/cashu/mintNuts';

/** Discovery row + the app-local method field (the shared MintSearchResult
 *  schema predates the capability data; extend locally rather than changing
 *  the cross-repo contract). */
export type MintSearchRow = MintSearchResult & {
  supported_methods: string[];
  /** NUT-04 (method, unit) pairs (lowercased) — the discovery filter matches the
   *  rail's exact pair, e.g. (bolt12, sat), not the method alone. */
  supported_method_units: { method: string; unit: string }[];
};

/**
 * Map a nagg discovery row to the screen's MintSearchResult shape. Review score
 * + count come inline (no per-mint fan-out); the operator's Nostr pubkey is
 * surfaced as a NUT-06 `contact` entry so the existing operator-profile path
 * still resolves.
 *
 * A testnut row's units become ACCOUNT units (`tsat`, `tusd`, … — wallet
 * `account-units`), so every unit filter downstream — the currency tabs, the
 * per-tab counts, the (method, unit) rail match — files test mints under their
 * own tBTC / tUSD tabs instead of among the real ones.
 */
export function discoverMintToSearchResult(m: DiscoverMint): MintSearchRow {
  const contact = m.operatorPubkey ? [{ method: 'nostr', info: m.operatorPubkey }] : [];
  const testnut = m.testnut === true;
  return {
    url: m.mintUrl,
    name: m.name || m.mintUrl,
    supported_units: (m.supportedUnits ?? []).map((unit) => toAccountUnit(unit, testnut)),
    // Derived from the raw NUT-06 nuts map (nuts['4'].methods) — nagg ships
    // capabilities undistilled by design.
    supported_methods: mintMethodsFromNuts(m.nuts),
    supported_method_units: mintMethodUnitPairsFromNuts(m.nuts, '4').map((pair) => ({
      ...pair,
      unit: toAccountUnit(pair.unit, testnut),
    })),
    state: m.state ?? 'unknown',
    n_mints: m.nMints ?? 0,
    n_melts: m.nMelts ?? 0,
    n_errors: m.nErrors ?? 0,
    review_score: m.averageScore,
    review_count: m.reviewCount,
    info: {
      ...(m.iconUrl ? { icon_url: m.iconUrl } : {}),
      ...(m.description ? { description: m.description } : {}),
      contact,
    },
  };
}

/** Name or URL contains `q`, case-insensitively; an empty query matches all. */
export function matchesMintQuery(result: MintSearchResult, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return result.name.toLowerCase().includes(needle) || result.url.toLowerCase().includes(needle);
}

/** Any supported unit is in the comma-separated `currency` list; 'ALL' or empty matches all. */
export function matchesMintCurrency(result: MintSearchResult, currency: string): boolean {
  if (!currency || currency === 'ALL') return true;
  const units = currency
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  if (units.length === 0) return true;
  return result.supported_units.some((u) => units.includes(u.toLowerCase()));
}

/**
 * Method filter for receive-rail discovery CTAs. A mint matches only when nagg
 * reported it advertises the method — absence means "not known to support", so
 * rows without the field are excluded while the filter is on.
 *
 * When a concrete currency (unit) is selected, matching is on the NUT-04
 * (method, unit) PAIR: a mint that advertises `bolt12` only for `eur` must NOT
 * match a `sat` rail. `currency === 'ALL'` (or empty) falls back to method-only
 * — the user explicitly chose to browse every unit.
 */
export function discoveryMethodMatches(
  result: MintSearchRow,
  method: string | undefined,
  currency: string
): boolean {
  if (!method) return true;
  const wantMethod = method.toLowerCase();
  const units = currency
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter((u) => u && u !== 'all');
  if (units.length === 0) {
    return result.supported_methods.some((m) => m.toLowerCase() === wantMethod);
  }
  return result.supported_method_units.some(
    (p) => p.method === wantMethod && units.includes(p.unit)
  );
}
