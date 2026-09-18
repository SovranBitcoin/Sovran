/**
 * The mint-detail read, group by group. The screen paints whatever the
 * unified metadata cache already knows (0ms), then each group revalidates on
 * its own clock and reports its own status, so an audit outage never blanks a
 * known review score and the stats block never unmounts (hunch rule ui/read-states).
 *
 * - identity (NUT-06): owned by the wallet bridge (`mintInfo` entry); this
 *   hook only reads its status/error and re-triggers it on Retry.
 * - audit: nagg discovery row via `getDiscoveredMintMetadata` when stale.
 * - reviews: aggregate via the session reviews cache (shared with the reviews
 *   screen, so opening it afterwards is a cache hit).
 * - social: operator profile via `useMintProfiles` when stale.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { mintReviewsCache, mintReviewsKey } from '@/features/mint/data/mintReviewsCache';
import { useMintProfiles } from '@/features/mint/hooks/useMintProfiles';
import { projectMintMeta } from '@/features/mint/lib/auditInfo';
import { retryMintInfoFetch } from '@/features/send/lib/createSovranScreenActionsBridge';
import { isSupersededError } from '@/shared/lib/cache/createQueryCacheStore';
import { getDiscoveredMintMetadata } from '@/shared/lib/getDiscoveredMintMetadata';
import { fetchMintReviews } from '@/shared/lib/nostr/fetchMintReviews';
import { extractMintNostrPubkey } from '@/shared/lib/nostr/extractMintNostrPubkey';
import { newReadId, readErrorType, readEvents, readKeyHash } from '@/shared/lib/read/readLog';
import {
  useCachedMintMetadata,
  useMintMetadataStore,
} from '@/shared/stores/global/mintMetadataStore';

export type MintDetailGroupStatus = 'loading' | 'ready' | 'empty' | 'error';

interface MintDetailRead {
  identity: MintDetailGroupStatus;
  /** Curated copy for a failed identity read (the bridge's `describeError`). */
  identityError: string | null;
  audit: MintDetailGroupStatus;
  reviews: MintDetailGroupStatus;
  social: MintDetailGroupStatus;
  /** Cached scalars projected for display (audit score/state/counts, review aggregate, operator). */
  meta: ReturnType<typeof projectMintMeta>;
  /** Re-run every failed group (identity via the bridge, audit + reviews here). */
  retry: () => void;
}

type GroupState = { fetching: boolean; failed: boolean; settled: boolean };
const IDLE: GroupState = { fetching: false, failed: false, settled: false };

function groupStatus(hasData: boolean, state: GroupState, stale: boolean): MintDetailGroupStatus {
  if (hasData) return 'ready';
  if (state.fetching || (stale && !state.settled)) return 'loading';
  if (state.failed) return 'error';
  return 'empty';
}

async function runAuditRead(mintUrl: string, signal: AbortSignal): Promise<boolean> {
  await getDiscoveredMintMetadata(mintUrl, { signal });
  // The read never throws; a still-stale audit group after it returns means
  // nagg could not be reached (a confirmed "nothing known" stamps the group).
  const store = useMintMetadataStore.getState();
  return !!store.getCached(mintUrl)?.auditAt || !store.isStale(mintUrl, 'audit');
}

async function runReviewsRead(mintUrl: string, signal: AbortSignal): Promise<boolean> {
  const key = mintReviewsKey(mintUrl);
  const readId = newReadId('mintReviews');
  const keyHash = readKeyHash(key);
  const cached = mintReviewsCache.getEntry(key);
  const t0 = Date.now();
  readEvents.request({
    readId,
    surface: 'mintReviews',
    keyHash,
    mode: cached ? 'revalidate' : 'initial',
    trigger: 'mount',
    action: cached ? 'serve-stale-revalidate' : 'fetch',
    strategy: 'aggregate',
    cached: !!cached,
    stale: true,
    coldStart: !cached,
    gen: mintReviewsCache.generation(key),
  });
  try {
    const data = await mintReviewsCache.run(
      key,
      async (ctx) => {
        const result = await fetchMintReviews({ mintUrl, signal: ctx.signal, readId: ctx.readId });
        if (result.isErr()) throw result.error;
        if (ctx.signal?.aborted) return { data: result.value };
        useMintMetadataStore
          .getState()
          .setReviewsAggregate(mintUrl, result.value.score, result.value.recommendations.length);
        return { data: result.value };
      },
      '',
      { signal, readId }
    );
    readEvents.done({
      readId,
      surface: 'mintReviews',
      keyHash,
      gen: mintReviewsCache.generation(key),
      durationMs: Date.now() - t0,
      source: 'network',
      tier: data.tier,
      count: data.recommendations.length,
      empty: data.recommendations.length === 0,
      degraded: data.degraded === true,
      complete: true,
    });
    return true;
  } catch (error) {
    if (isSupersededError(error) || signal.aborted) {
      readEvents.superseded({
        readId,
        surface: 'mintReviews',
        keyHash,
        gen: mintReviewsCache.generation(key),
        reason: signal.aborted ? 'abort' : 'newer-request',
      });
      return true;
    }
    readEvents.failed({
      readId,
      surface: 'mintReviews',
      keyHash,
      gen: mintReviewsCache.generation(key),
      durationMs: Date.now() - t0,
      errorType: readErrorType(error),
      retained: !!cached,
    });
    return false;
  }
}

export function useMintDetailRead(
  mintUrl: string,
  entry: Record<string, unknown> | null
): MintDetailRead {
  const cached = useCachedMintMetadata(mintUrl || null);
  const meta = useMemo(() => projectMintMeta(cached), [cached]);
  const [attempt, setAttempt] = useState(0);
  const [audit, setAudit] = useState<GroupState>(IDLE);
  const [reviews, setReviews] = useState<GroupState>(IDLE);

  // Audit + reviews: revalidate when the group is stale; a Retry bumps `attempt`.
  useEffect(() => {
    if (!mintUrl) return;
    const store = useMintMetadataStore.getState();
    const controller = new AbortController();
    const groups: [
      boolean,
      (mintUrl: string, signal: AbortSignal) => Promise<boolean>,
      (next: GroupState) => void,
    ][] = [
      [store.isStale(mintUrl, 'audit'), runAuditRead, setAudit],
      [store.isStale(mintUrl, 'reviews'), runReviewsRead, setReviews],
    ];
    for (const [stale, run, set] of groups) {
      if (!stale) {
        set({ fetching: false, failed: false, settled: true });
        continue;
      }
      set({ fetching: true, failed: false, settled: false });
      void run(mintUrl, controller.signal).then((ok) => {
        if (controller.signal.aborted) return;
        set({ fetching: false, failed: !ok, settled: true });
      });
    }
    return () => controller.abort();
  }, [mintUrl, attempt]);

  // Social: operator profile from the NUT-06 contact, through the shared hook
  // (it writes `setSocial`, which re-renders us via the cached entry).
  // NUT-06 contact first; a placeholder there falls back to the operator nagg's
  // discovery row resolved (the same rule the screen's Contact row uses).
  const contact = entry?.contact;
  const discoveredOperator = cached?.operatorPubkey;
  const operatorPubkey = useMemo(
    () =>
      extractMintNostrPubkey({ contact: Array.isArray(contact) ? contact : undefined }) ??
      discoveredOperator,
    [contact, discoveredOperator]
  );
  const profileInputs = useMemo(
    () =>
      mintUrl && operatorPubkey
        ? [{ url: mintUrl, mintInfo: { contact: [{ method: 'nostr', info: operatorPubkey }] } }]
        : [],
    [mintUrl, operatorPubkey]
  );
  useMintProfiles(profileInputs);

  const identityError = typeof entry?._mintInfoError === 'string' ? entry._mintInfoError : null;
  const identity: MintDetailGroupStatus =
    !mintUrl || !entry ? 'loading' : identityError ? 'error' : 'ready';

  const hasAudit = meta.auditState !== undefined || meta.auditScore !== undefined;
  const hasReviews = meta.kymScore !== undefined || meta.reviewCount !== undefined;
  const hasSocial = meta.contactFollowers !== undefined || meta.contactReputation !== undefined;
  const socialStale = useMintMetadataStore((s) => (mintUrl ? s.isStale(mintUrl, 'social') : false));
  const social: MintDetailGroupStatus = hasSocial
    ? 'ready'
    : identity === 'loading'
      ? 'loading'
      : operatorPubkey && socialStale
        ? 'loading'
        : 'empty';

  const retry = useCallback(() => {
    if (identityError) retryMintInfoFetch();
    setAttempt((n) => n + 1);
  }, [identityError]);

  return {
    identity,
    identityError,
    audit: groupStatus(hasAudit, audit, mintUrl ? !cached?.auditAt : false),
    reviews: groupStatus(hasReviews, reviews, mintUrl ? !cached?.reviewsAt : false),
    social,
    meta,
    retry,
  };
}
