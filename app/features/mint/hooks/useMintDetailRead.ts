/**
 * The mint-detail read, group by group. The screen paints whatever the
 * unified metadata cache already knows (0ms), then each group revalidates on
 * its own clock and reports its own status, so an audit outage never blanks a
 * known review score and the stats block never unmounts (hunch rule ui/read-states).
 *
 * - identity (NUT-06): owned by the wallet bridge (`mintInfo` entry); this
 *   hook only reads its status/error and re-triggers it on Retry.
 * - audit: the merged auditor directory row via `getDiscoveredMintMetadata`
 *   when stale, plus this page's own per-mint auditor reads
 *   (`readMintAuditDetail`: MintRadar's single-mint figures, the CDK
 *   auditors' uptime and metrics), which only this page makes.
 * - reviews: aggregate via the session reviews cache (shared with the reviews
 *   screen, so opening it afterwards is a cache hit).
 * - social: operator profile via `useMintProfiles` when stale.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { mintReviewsCache, mintReviewsKey } from '@/features/mint/data/mintReviewsCache';
import { useMintProfiles } from '@/features/mint/hooks/useMintProfiles';
import { projectMintMeta } from '@/features/mint/lib/auditInfo';
import { mintAuditDetailDue, readMintAuditDetail } from '@/features/mint/lib/mintAuditDetail';
import { selectMintInfoStats, type MintInfoStats } from '@/features/mint/lib/mintInfoStats';
import { retryMintInfoFetch } from '@/features/send/lib/createSovranScreenActionsBridge';
import { isSupersededError } from '@/shared/lib/cache/createQueryCacheStore';
import { getDiscoveredMintMetadata } from '@/shared/lib/getDiscoveredMintMetadata';
import { readMintReviews } from '@/features/mint/data/readMintReviews';
import { extractMintNostrPubkey } from '@/shared/lib/nostr/extractMintNostrPubkey';
import { newReadId, readErrorType, readEvents, readKeyHash } from '@/shared/lib/read/readLog';
import {
  isMintMetaGroupStale,
  useCachedMintMetadata,
  useMintMetadataStore,
} from '@/shared/stores/global/mintMetadataStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { onceLoaded, whenLoaded } from '@/shared/lib/persist/hydrationOutcome';
import { useMintTestnutStore } from '@/shared/stores/global/mintTestnutStore';
import { dataResetGeneration } from '@/shared/lib/account/dataResetFence';

export type MintDetailGroupStatus = 'loading' | 'ready' | 'empty' | 'error';

interface MintDetailRead {
  identity: MintDetailGroupStatus;
  /** Curated copy for a failed identity read (the bridge's `describeError`). */
  identityError: string | null;
  audit: MintDetailGroupStatus;
  reviews: MintDetailGroupStatus;
  social: MintDetailGroupStatus;
  /** Cached scalars projected for display (the audit summary, review aggregate, operator). */
  meta: ReturnType<typeof projectMintMeta>;
  /** The four Mint Info numbers, each from one named source. */
  stats: MintInfoStats;
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
  // Gated like the auditor detail reads below: which auditors may be asked is
  // a saved setting, and the answer is written into saved mint rows.
  const generation = dataResetGeneration();
  const options = { orFailed: true };
  const loaded = await Promise.all([
    whenLoaded(useSettingsStore, options),
    whenLoaded(useMintMetadataStore, options),
    whenLoaded(useMintTestnutStore, options),
  ]);
  if (!loaded.every(Boolean) || signal.aborted || dataResetGeneration() !== generation) {
    return false;
  }
  // Writes only while the same holds when the answer lands.
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
    const data = await mintReviewsCache.run(key, (ctx) => readMintReviews(mintUrl, ctx), '', {
      signal,
      readId,
    });
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
  const stats = useMemo(() => selectMintInfoStats(cached), [cached]);
  const [attempt, setAttempt] = useState(0);
  const [openedAtMs] = useState(() => Date.now());
  const [audit, setAudit] = useState<GroupState>(IDLE);
  const [reviews, setReviews] = useState<GroupState>(IDLE);
  const [detail, setDetail] = useState<GroupState>(IDLE);

  // Audit + reviews: revalidate when the group is stale; a Retry bumps `attempt`.
  useEffect(() => {
    if (!mintUrl) return;
    const store = useMintMetadataStore.getState();
    const nowMs = Date.now();
    const controller = new AbortController();
    const groups: [
      boolean,
      (mintUrl: string, signal: AbortSignal) => Promise<boolean>,
      (next: GroupState) => void,
    ][] = [
      [store.isStale(mintUrl, 'audit', undefined, nowMs), runAuditRead, setAudit],
      [store.isStale(mintUrl, 'reviews', undefined, nowMs), runReviewsRead, setReviews],
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

  // This page's own per-mint auditor reads, at most once per mint every few
  // minutes. Gated on the settings load: which auditors may be asked is the
  // person's choice, and the in-code default would ask them all. Their
  // answers are written only once the saved mint rows have loaded (a write
  // before that is saved over them) and only if Delete All has not run since.
  useEffect(() => {
    if (!mintUrl) return;
    const controller = new AbortController();
    const forced = attempt > 0;
    const generation = dataResetGeneration();
    const run = (loaded: boolean) => {
      if (!loaded || controller.signal.aborted) return;
      if (!forced && !mintAuditDetailDue(mintUrl, Date.now())) {
        setDetail({ fetching: false, failed: false, settled: true });
        return;
      }
      const settings = useSettingsStore.getState();
      setDetail({ fetching: true, failed: false, settled: false });
      void readMintAuditDetail(mintUrl, {
        held: useMintMetadataStore.getState().getCached(mintUrl)?.auditObservations,
        disabledAuditors: settings.disabledMintAuditors,
        enabledAuditors: settings.enabledMintAuditors,
        signal: controller.signal,
      }).then(({ updates, answered }) => {
        if (controller.signal.aborted) return;
        onceLoaded(useMintMetadataStore, (metadataLoaded) => {
          if (!metadataLoaded || dataResetGeneration() !== generation) return;
          useMintMetadataStore.getState().recordAuditObservations(mintUrl, updates);
        });
        setDetail({ fetching: false, failed: !answered, settled: true });
      });
    };
    onceLoaded(useSettingsStore, run);
    return () => controller.abort();
  }, [mintUrl, attempt]);

  // A read that failed is tried again when the page is returned to: it was
  // the network's answer at one moment, not the mint's. Held in a ref so the
  // failure itself does not re-run the focus effect and retry in a loop.
  const failedRef = useRef(false);
  useEffect(() => {
    failedRef.current = audit.failed || reviews.failed;
  }, [audit.failed, reviews.failed]);
  useFocusEffect(
    useCallback(() => {
      if (failedRef.current) setAttempt((n) => n + 1);
    }, [])
  );

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

  const hasAudit =
    meta.audit !== undefined ||
    stats.uptime !== undefined ||
    stats.operations !== undefined ||
    stats.latency !== undefined;
  const hasReviews = meta.kymScore !== undefined || meta.reviewCount !== undefined;
  const hasSocial = meta.contactFollowers !== undefined || meta.contactReputation !== undefined;
  const socialStale = mintUrl ? isMintMetaGroupStale(cached, 'social', openedAtMs) : false;
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
    audit: groupStatus(
      hasAudit,
      {
        fetching: audit.fetching || detail.fetching,
        // Failed only when both reads failed: one source answering is an answer.
        failed: audit.failed && (detail.failed || !detail.settled),
        settled: audit.settled && (detail.settled || !mintUrl),
      },
      mintUrl ? !cached?.auditAt : false
    ),
    reviews: groupStatus(hasReviews, reviews, mintUrl ? !cached?.reviewsAt : false),
    social,
    meta,
    stats,
    retry,
  };
}
