/**
 * Per-mint catalog fetcher with a deterministic source preference.
 *
 *   1. **Audit endpoint** (`/cashu/mint/audit`) — preferred because one
 *      response carries both audit aggregates (n_mints / n_melts / n_errors)
 *      AND the mint's NUT-06 `info` (with `contact` for the operator's
 *      Nostr pubkey). Reviewed mints get audit + score + nostr in two HTTP
 *      calls (audit + reviews) instead of three (audit + reviews + info).
 *
 *   2. **Coco `getMintInfo`** — fallback for mints the auditor doesn't track
 *      (e.g. `mint.sovran.money` is excluded from `api.sovran.money`'s audit
 *      DB). Returns NUT-06 info directly from the mint, so we still get the
 *      operator pubkey and can resolve their Nostr profile.
 *
 *   3. **Reviews endpoint** (`/cashu/mint/reviews`) — independent of audit,
 *      runs in parallel for every mint. Provides KYM score + review count.
 *
 * Side effects: populates the audit / KYM / mint-profile Zustand stores
 * along the way so the trust-review screen and other surfaces that read
 * from those caches get fresh data without a second round-trip.
 */

import type { GetInfoResponse } from '@cashu/cashu-ts';
import type { MintCatalogEntry } from 'coco-payment-ux';

import { auditMint, fetchNostrProfile, reviewMint } from '@/shared/lib/apiClient';
import {
  extractMintNostrPubkey,
  type MintInfoForNostr,
} from '@/shared/lib/nostr/extractMintNostrPubkey';
import { useAuditMintStore } from '@/shared/stores/global/auditMintStore';
import { useKYMMintStore } from '@/shared/stores/global/kymMintStore';
import { useMintProfileStore } from '@/shared/stores/global/mintProfileStore';

function isMintInfoObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 0
  );
}

function deriveAuditScore(n_mints: number, n_melts: number, n_errors: number): number | undefined {
  const totalOps = n_mints + n_melts;
  if (totalOps <= 0) return undefined;
  const successRate = 1 - n_errors / totalOps;
  return Math.max(0, Math.min(1, successRate)) * 5;
}

async function resolveNostrProfile(
  mintUrl: string,
  pubkey: string,
  signal?: AbortSignal
): Promise<{ followers: number; reputation: number } | undefined> {
  const profileStore = useMintProfileStore.getState();
  const cached = profileStore.getCached(mintUrl);
  if (cached && !profileStore.isStale(mintUrl)) {
    return { followers: cached.followers, reputation: cached.reputation };
  }
  const profile = await fetchNostrProfile(pubkey, { signal }).catch(() => null);
  if (profile && profile.isOk()) {
    const { followers, score } = profile.value;
    useMintProfileStore.getState().setCached(mintUrl, followers, score);
    return { followers, reputation: score };
  }
  return undefined;
}

/**
 * Fetcher signature exposed by the wallet. The Manager-bound `getMintInfo`
 * is passed in so this module stays standalone (callable from React hooks
 * and from coco-payment-ux's machine-driven code path).
 */
export type MintInfoLookup = (mintUrl: string) => Promise<GetInfoResponse | null>;

async function fetchEntry(
  mintUrl: string,
  getMintInfo: MintInfoLookup,
  signal?: AbortSignal
): Promise<MintCatalogEntry> {
  const [auditRes, reviewRes] = await Promise.all([
    auditMint({ mintUrl, signal }).catch(() => null),
    reviewMint({ mintUrl, signal }).catch(() => null),
  ]);

  const entry: MintCatalogEntry = {};
  let info: unknown = null;

  // Audit data + info from the audit endpoint when available …
  if (auditRes && auditRes.isOk()) {
    const audit = auditRes.value;
    entry.auditScore = deriveAuditScore(audit.n_mints, audit.n_melts, audit.n_errors);
    entry.auditState = audit.state;
    entry.auditTotalOps = audit.n_mints + audit.n_melts;
    // The auditor returns `info` in inconsistent shapes (object, null, "")
    // depending on whether it could reach the upstream mint. Only treat a
    // populated NUT-06-shaped object as usable; otherwise fetch direct so
    // operator pubkey resolution and the cached `mintInfo` stay populated.
    info = isMintInfoObject(audit.info) ? audit.info : null;
    if (!info) {
      info = await getMintInfo(mintUrl).catch(() => null);
    }
    if (info) {
      useAuditMintStore.getState().setCached(mintUrl, audit, info as unknown as GetInfoResponse);
    }
  } else {
    // … otherwise hit the mint directly for NUT-06 info so we can still
    // resolve the operator's Nostr profile. No audit data is available
    // in this path — the row will render without the audit pill.
    info = await getMintInfo(mintUrl).catch(() => null);
  }

  if (reviewRes && reviewRes.isOk()) {
    const review = reviewRes.value;
    if (review.score !== null) {
      entry.kymScore = review.score;
      useKYMMintStore.getState().setCached(mintUrl, review.score, review.recommendations);
    }
    // `recommendations` is the authoritative source for the count regardless
    // of whether `score` was computable — keep it visible either way.
    entry.reviewCount = review.recommendations.length;
  }

  const pubkey = extractMintNostrPubkey(info as MintInfoForNostr);
  if (pubkey) {
    const profile = await resolveNostrProfile(mintUrl, pubkey, signal);
    if (profile) {
      entry.contactFollowers = profile.followers;
      entry.contactReputation = Math.round(profile.reputation);
    }
  }

  return entry;
}

/**
 * Pull the catalog for `mintUrls` in parallel. Each mint independently
 * resolves audit / review / Nostr-profile data; failures on any single
 * mint never block the others. `signal` cancels every in-flight request
 * for the batch — pass it from the calling effect's cleanup.
 */
export async function getMintCatalog(
  mintUrls: string[],
  getMintInfo: MintInfoLookup,
  signal?: AbortSignal
): Promise<Record<string, MintCatalogEntry>> {
  if (mintUrls.length === 0) return {};
  const entries = await Promise.all(
    mintUrls.map(async (url) => [url, await fetchEntry(url, getMintInfo, signal)] as const)
  );
  return Object.fromEntries(entries);
}
