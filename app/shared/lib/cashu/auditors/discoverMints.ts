import { err, ok, type Result } from 'neverthrow';
import { DiscoverMintsResponse, type DiscoverMint } from '@/shared/lib/apiClient';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import {
  fetchCashuAuditDirectory,
  fetchImfDirectory,
  fetchMacadamiaDirectory,
  fetchMintRadarDirectory,
  fetchMintRadarSingle,
  fetchNip87Directory,
  fetchUcashDirectory,
  type AuditorFetchControls,
  type AuditorMintEntry,
} from './adapters';
import { mergeAuditObservations } from './observation';
import { resolveEnabledAuditors, type MintAuditorId, type MintAuditSummary } from './registry';

type AuditorAdapterMap = Record<
  MintAuditorId,
  (controls: AuditorFetchControls) => Promise<AuditorMintEntry[]>
>;

const DEFAULT_ADAPTERS: AuditorAdapterMap = {
  nip87: fetchNip87Directory,
  mintradar: fetchMintRadarDirectory,
  'cashu-audit': fetchCashuAuditDirectory,
  'imf-gg': fetchImfDirectory,
  ucash: fetchUcashDirectory,
  macadamia: fetchMacadamiaDirectory,
};

function mergeUnits(a?: string[], b?: string[]): string[] {
  const set = new Set<string>();
  for (const u of a ?? []) if (u) set.add(u.toLowerCase());
  for (const u of b ?? []) if (u) set.add(u.toLowerCase());
  return set.size > 0 ? [...set] : ['sat'];
}

function rankScore(mint: DiscoverMint): number {
  const count = mint.reviewCount ?? 0;
  const avg = mint.averageScore ?? 3.0;
  // Smoothed rating (two phantom 3-star reviews so a single 5-star doesn't dominate).
  const smoothed = (avg * count + 6) / (count + 2);
  const totalSwaps = (mint.nMints ?? 0) + (mint.nMelts ?? 0) + (mint.nErrors ?? 0);
  const swapFactor = totalSwaps > 0 ? ((mint.nMints ?? 0) + (mint.nMelts ?? 0)) / totalSwaps : 0.9;
  const healthPenalty = mint.status === 'offline' || mint.state === 'ERROR' ? 0.1 : 1;
  return (smoothed / 5) * swapFactor * healthPenalty;
}

function isAuditSource(source: MintAuditorId): boolean {
  return (
    source === 'mintradar' ||
    source === 'cashu-audit' ||
    source === 'ucash' ||
    source === 'macadamia'
  );
}

export function mergeAuditorEntries(entries: readonly AuditorMintEntry[]): DiscoverMint[] {
  const byKey = new Map<string, DiscoverMint>();

  for (const entry of entries) {
    // Preserve path case while normalizing scheme/host/trailing-slash so
    // distinct endpoints like /Cashu vs /cashu do not collide.
    const key = normalizeMintUrlKey(entry.mintUrl);
    if (!key) continue;
    const audited = isAuditSource(entry.source);
    const reviewCount =
      typeof entry.reviewCount === 'number' && Number.isFinite(entry.reviewCount)
        ? Math.max(0, Math.round(entry.reviewCount))
        : 0;
    const averageScore =
      typeof entry.averageScore === 'number' && Number.isFinite(entry.averageScore)
        ? Math.min(5, Math.max(0, entry.averageScore))
        : 0;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        mintUrl: entry.mintUrl,
        name: entry.name ?? entry.mintUrl,
        description: entry.description,
        iconUrl: entry.iconUrl,
        supportedUnits: mergeUnits(entry.supportedUnits),
        nuts: entry.nuts,
        operatorPubkey: entry.operatorPubkey,
        hasAudit: audited,
        state: entry.state,
        status: entry.status,
        testnut: entry.testnut,
        nMints: entry.nMints !== undefined ? Math.max(0, Math.round(entry.nMints)) : undefined,
        nMelts: entry.nMelts !== undefined ? Math.max(0, Math.round(entry.nMelts)) : undefined,
        nErrors: entry.nErrors !== undefined ? Math.max(0, Math.round(entry.nErrors)) : undefined,
        reviewCount,
        averageScore,
        ...(entry.observation
          ? { auditObservations: mergeAuditObservations(undefined, [entry.observation]) }
          : {}),
      });
      continue;
    }

    if (entry.observation) {
      existing.auditObservations = mergeAuditObservations(existing.auditObservations, [
        entry.observation,
      ]);
    }

    if (audited) existing.hasAudit = true;

    // Merge richer metadata, preferring non-URL names and existing NUT-06 details.
    if (entry.name && (!existing.name || existing.name === existing.mintUrl)) {
      existing.name = entry.name;
    }
    if (entry.description && !existing.description) existing.description = entry.description;
    if (entry.iconUrl && !existing.iconUrl) existing.iconUrl = entry.iconUrl;
    if (entry.nuts && !existing.nuts) existing.nuts = entry.nuts;
    if (entry.operatorPubkey && !existing.operatorPubkey) {
      existing.operatorPubkey = entry.operatorPubkey;
    }
    if (entry.supportedUnits?.length) {
      existing.supportedUnits = mergeUnits(existing.supportedUnits, entry.supportedUnits);
    }
    if (entry.testnut === true) existing.testnut = true;

    // Prefer MintRadar's live 5-min status when present, otherwise fill missing.
    if (entry.source === 'mintradar' && entry.status) {
      existing.status = entry.status;
      if (entry.state) existing.state = entry.state;
    } else {
      if (!existing.status && entry.status) existing.status = entry.status;
      if (!existing.state && entry.state) existing.state = entry.state;
    }

    // Prefer the richer swap count record.
    const existingSwaps = (existing.nMints ?? 0) + (existing.nMelts ?? 0) + (existing.nErrors ?? 0);
    const entrySwaps = (entry.nMints ?? 0) + (entry.nMelts ?? 0) + (entry.nErrors ?? 0);
    if (entrySwaps > existingSwaps) {
      existing.nMints =
        entry.nMints !== undefined ? Math.max(0, Math.round(entry.nMints)) : existing.nMints;
      existing.nMelts =
        entry.nMelts !== undefined ? Math.max(0, Math.round(entry.nMelts)) : existing.nMelts;
      existing.nErrors =
        entry.nErrors !== undefined ? Math.max(0, Math.round(entry.nErrors)) : existing.nErrors;
    }

    // Prefer the review directory with more reviews.
    if (reviewCount > (existing.reviewCount ?? 0)) {
      existing.reviewCount = reviewCount;
      if (entry.averageScore !== undefined) existing.averageScore = averageScore;
    }
  }

  // Validate every merged row against the shared DiscoverMint schema so
  // malformed third-party data never poisons persisted discovery/metadata caches.
  const rowSchema = DiscoverMintsResponse.shape.mints.element;
  const validated: DiscoverMint[] = [];
  for (const row of byKey.values()) {
    const parsed = rowSchema.safeParse(row);
    if (parsed.success) validated.push(parsed.data);
  }

  return validated.sort((a, b) => {
    const scoreDiff = rankScore(b) - rankScore(a);
    if (Math.abs(scoreDiff) > 1e-6) return scoreDiff;
    return (a.name ?? a.mintUrl).localeCompare(b.name ?? b.mintUrl);
  });
}

export async function discoverMintsFromAuditors(
  options: {
    disabledAuditors?: readonly string[];
    /** Opt-in auditors the person switched on (`settingsStore.enabledMintAuditors`). */
    enabledAuditors?: readonly string[];
    limit?: number;
    signal?: AbortSignal;
    adapters?: Partial<AuditorAdapterMap>;
  } = {}
): Promise<Result<DiscoverMintsResponse, Error>> {
  const enabled = resolveEnabledAuditors(
    options.disabledAuditors ?? [],
    options.enabledAuditors ?? []
  );
  if (enabled.length === 0) {
    return ok({ mints: [] });
  }
  const adapters = { ...DEFAULT_ADAPTERS, ...options.adapters };
  const settled = await Promise.allSettled(
    enabled.map((id) => adapters[id]({ signal: options.signal }))
  );

  if (options.signal?.aborted) {
    return err(new Error('Mint discovery aborted'));
  }

  const allEntries: AuditorMintEntry[] = [];
  let succeededCount = 0;
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      succeededCount += 1;
      allEntries.push(...outcome.value);
    }
  }
  if (succeededCount === 0) {
    return err(new Error('All enabled mint auditors failed'));
  }

  const merged = mergeAuditorEntries(allEntries);
  const mints = options.limit ? merged.slice(0, options.limit) : merged;
  return ok({ mints });
}

/**
 * Best-effort single-mint audit summary using enabled HTTP auditors.
 * Returns `undefined` if MintRadar is disabled or unreachable — never throws.
 */
export async function fetchMintAuditSummary(
  mintUrl: string,
  options: {
    disabledAuditors?: readonly string[];
    signal?: AbortSignal;
    fetchSingle?: typeof fetchMintRadarSingle;
  } = {}
): Promise<MintAuditSummary | undefined> {
  const enabled = resolveEnabledAuditors(options.disabledAuditors ?? []);
  if (!enabled.includes('mintradar')) return undefined;
  const fetcher = options.fetchSingle ?? fetchMintRadarSingle;
  return fetcher(mintUrl, { signal: options.signal });
}
