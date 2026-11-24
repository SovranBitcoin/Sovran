/**
 * One mint's info history, as this phone recorded it (`mint-history-store`,
 * ADR 0036), already phrased, newest first.
 *
 * The revisions are local: nothing is fetched to show them. Opening the page
 * marks the mint as recently viewed (it is kept longest), asks the mint once
 * when there is no baseline yet, and `refresh` asks it again on demand. A
 * failed check leaves the saved history on screen and says so.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Entry } from '@/features/mint/lib/mintChanges/decode';
import {
  buildMintChangeListItems,
  type MintChangeRevision,
} from '@/features/mint/lib/mintChanges/groupEntries';
import type { NutsMap } from '@/features/mint/lib/mintChanges/interpret';
import { checkMintInfoNow } from '@/features/mint/lib/mintHistorySync';
import { describeError } from '@/shared/lib/errors';
import { onceLoaded, useStoreLoadLatched } from '@/shared/lib/persist/hydrationOutcome';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import {
  useMintHistoryStore,
  type MintHistoryEntry,
} from '@/shared/stores/profile/mintHistoryStore';

/**
 * - `loading`: the saved history has not loaded yet.
 * - `waiting`: this phone has never had an answer from the mint.
 * - `unchanged`: it has, and nothing changed since the first one.
 * - `changed`: there are revisions to show.
 */
type MintHistoryStatus = 'loading' | 'waiting' | 'unchanged' | 'changed';

const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url.replace(/^https?:\/\//, '');
  }
};

/** The saved revisions in the shape the change phrases read (seconds, newest first). */
function historyEntries(entry: MintHistoryEntry | undefined): Entry[] {
  if (!entry) return [];
  const host = hostOf(entry.mintUrl);
  const name =
    entry.baseline && typeof entry.baseline.name === 'string' && entry.baseline.name.trim()
      ? entry.baseline.name.trim()
      : host;
  return entry.revisions.map((revision) => ({
    mintUrl: entry.mintUrl,
    host,
    name,
    at: Math.floor(revision.at / 1000),
    ...(revision.previousLastSeenAt !== undefined && revision.previousLastSeenAt < revision.at
      ? { sincePrevious: Math.floor((revision.at - revision.previousLastSeenAt) / 1000) }
      : {}),
    // The revision's own id: two revisions can produce the same document.
    hash: revision.id,
    patch: revision.patch,
    summary: [],
  }));
}

export function useMintChangeRevisions(mintUrl: string | undefined) {
  const loaded = useStoreLoadLatched(useMintHistoryStore.persist);
  const key = mintUrl ? normalizeMintUrlKey(mintUrl) : '';
  const entry = useMintHistoryStore((state) => (key ? state.byMintUrl[key] : undefined));
  const [isRefreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<{ key: string; message: string } | null>(null);

  const revisions = useMemo<MintChangeRevision[]>(() => {
    const entries = historyEntries(entry);
    if (entries.length === 0) return [];
    // The current capability map names the unit a limit change leaves out.
    const nuts = entry?.baseline?.nuts as NutsMap;
    return buildMintChangeListItems(entries, () => nuts)[0]?.revisions ?? [];
  }, [entry]);

  const refresh = useCallback(async () => {
    if (!mintUrl) return;
    setRefreshing(true);
    const result = await checkMintInfoNow(mintUrl);
    setRefreshing(false);
    setRefreshError(result.ok ? null : { key, message: describeError(result.error, 'cashu').text });
  }, [mintUrl, key]);

  // On open, once the saved history has loaded: keep this mint longest, and
  // ask it now if this phone has never had an answer from it.
  useEffect(() => {
    if (!mintUrl) return;
    let cancelled = false;
    onceLoaded(useMintHistoryStore, (ok) => {
      if (!ok || cancelled) return;
      const store = useMintHistoryStore.getState();
      store.markViewed(mintUrl);
      if (!store.byMintUrl[normalizeMintUrlKey(mintUrl)]?.baseline) void refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [mintUrl, refresh]);

  const status: MintHistoryStatus = !loaded
    ? 'loading'
    : !entry?.baseline
      ? 'waiting'
      : revisions.length > 0
        ? 'changed'
        : 'unchanged';

  const lastFailed = (entry?.consecutiveFailures ?? 0) > 0;
  const errorMessage =
    refreshError?.key === key
      ? refreshError.message
      : lastFailed && !isRefreshing
        ? "Couldn't reach this mint the last time it was checked."
        : null;

  return {
    revisions,
    status,
    isLoading: status === 'loading' || (status === 'waiting' && isRefreshing),
    isRefreshing,
    errorMessage,
    /** When this phone first had an answer, epoch ms. */
    firstSeenAt: entry?.firstSeenAt,
    refresh,
  };
}
