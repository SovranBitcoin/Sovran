/**
 * @fileoverview Tier-0 search: matches over what the phone already holds.
 *
 * People the person has paid or been paid by, people they follow, and the
 * mints in their account are matched here from the first character, with no
 * network and no debounce. The remote people search (Tier 1) still runs for
 * longer queries; its rows are appended under these and de-duplicated by
 * pubkey, so a person shows once.
 *
 * Pure on purpose: the hooks gather the candidates, this ranks them.
 */

/** Where a locally known person came from; recents outrank follows on a tie. */
export type LocalPersonSource = 'recent' | 'following';

export interface LocalPersonCandidate {
  pubkey: string;
  source: LocalPersonSource;
  displayName?: string | null;
  name?: string | null;
  nip05?: string | null;
  lud16?: string | null;
  picture?: string | null;
}

export interface LocalMintCandidate {
  mintUrl: string;
  displayName?: string | null;
  iconUrl?: string | null;
}

/** Rows a section shows from local matches before it stops. */
export const LOCAL_PEOPLE_LIMIT = 8;
const LOCAL_MINTS_LIMIT = 8;

/**
 * Candidates read per query. Follow lists run into the thousands; past this
 * the scan stops, so one keystroke stays well under a frame on old phones.
 */
export const LOCAL_SCAN_LIMIT = 5000;

/** Lower-case and strip accents, so "zoë" matches "zoe". */
function normalizeSearchText(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * How well `field` matches `query` (both normalized): 3 for a prefix of the
 * whole field, 2 for a prefix of a later word, 1 for anywhere inside, 0 for no
 * match.
 */
function fieldScore(field: string | null | undefined, query: string): number {
  if (!field) return 0;
  const value = normalizeSearchText(field);
  if (!value) return 0;
  if (value.startsWith(query)) return 3;
  const at = value.indexOf(query);
  if (at < 0) return 0;
  const before = value[at - 1];
  return before === ' ' || before === '.' || before === '@' || before === '_' || before === '-'
    ? 2
    : 1;
}

function bestScore(fields: readonly (string | null | undefined)[], query: string): number {
  let best = 0;
  for (const field of fields) {
    const score = fieldScore(field, query);
    if (score > best) best = score;
    if (best === 3) break;
  }
  return best;
}

interface Ranked<T> {
  item: T;
  score: number;
  order: number;
}

function rankAndTake<T>(ranked: Ranked<T>[], limit: number): T[] {
  ranked.sort((a, b) => b.score - a.score || a.order - b.order);
  return ranked.slice(0, limit).map((entry) => entry.item);
}

/**
 * Locally known people whose name, NIP-05 or Lightning address matches the
 * query, best match first. A person listed twice (recent and followed) is
 * kept once, as the earlier source. Matches from one character.
 */
export function matchLocalPeople(
  candidates: readonly LocalPersonCandidate[],
  rawQuery: string,
  limit: number = LOCAL_PEOPLE_LIMIT
): LocalPersonCandidate[] {
  const query = normalizeSearchText(rawQuery);
  if (!query || limit <= 0) return [];
  const seen = new Set<string>();
  const ranked: Ranked<LocalPersonCandidate>[] = [];
  const scan = Math.min(candidates.length, LOCAL_SCAN_LIMIT);
  for (let i = 0; i < scan; i += 1) {
    const person = candidates[i];
    if (!person?.pubkey || seen.has(person.pubkey)) continue;
    seen.add(person.pubkey);
    const match = bestScore([person.displayName, person.name, person.nip05, person.lud16], query);
    if (match === 0) continue;
    // Recents first on equal match quality: the person was just paid.
    const score = match * 2 + (person.source === 'recent' ? 1 : 0);
    ranked.push({ item: person, score, order: i });
  }
  return rankAndTake(ranked, limit);
}

/** The account's mints whose name or address matches the query. */
export function matchLocalMints(
  candidates: readonly LocalMintCandidate[],
  rawQuery: string,
  limit: number = LOCAL_MINTS_LIMIT
): LocalMintCandidate[] {
  const query = normalizeSearchText(rawQuery);
  if (!query || limit <= 0) return [];
  const seen = new Set<string>();
  const ranked: Ranked<LocalMintCandidate>[] = [];
  const scan = Math.min(candidates.length, LOCAL_SCAN_LIMIT);
  for (let i = 0; i < scan; i += 1) {
    const mint = candidates[i];
    if (!mint?.mintUrl || seen.has(mint.mintUrl)) continue;
    seen.add(mint.mintUrl);
    const host = mint.mintUrl.replace(/^https?:\/\//i, '');
    const score = bestScore([mint.displayName, host], query);
    if (score === 0) continue;
    ranked.push({ item: mint, score, order: i });
  }
  return rankAndTake(ranked, limit);
}
