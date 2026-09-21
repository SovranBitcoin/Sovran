/**
 * Background refresh for `mintTestnutStore` — the only network path behind the
 * testnut account split. Never awaited by UI and never throws: a failed pass
 * leaves every stored verdict standing.
 *
 * Kept out of the store module so the screens that only READ verdicts do not
 * pull the API client in with them.
 */
import type { Manager } from '@cashu/coco-core';
import { AppState } from 'react-native';

import { fetchMintInfos, MINT_INFO_MAX_URLS } from '@/shared/lib/apiClient';
import { storeLog } from '@/shared/lib/logger';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { useMintTestnutStore } from '@/shared/stores/global/mintTestnutStore';

/** nagg re-probes weekly; a daily re-check picks a new verdict up promptly. */
const RECHECK_MS = 24 * 60 * 60 * 1000;

/**
 * A row nagg answered with no `probedAt` is "not probed yet", NOT "real mint" —
 * and `applyMintInfos` still stamps `checkedAt` on it so a pass does not spin.
 * Re-asking on the daily clock therefore left an unprobed mint counted as real
 * for a whole day, and every account-scoped decision in between trusted it: a
 * captured session offered "as Onchain" for 1 sat because the only mint that
 * could serve it was an unclassified testnut, and the rail vanished the moment
 * an unrelated discovery call supplied the verdict.
 */
const UNPROBED_RECHECK_MS = 10 * 60 * 1000;

/** nagg unreachable: leave it alone for a minute rather than retry per trigger. */
const FAILURE_BACKOFF_MS = 60 * 1000;

let inflight: Promise<void> | null = null;
let lastFailureAt = 0;

export function needsCheck(mintUrl: string, now: number): boolean {
  const entry = useMintTestnutStore.getState().byMintUrl[normalizeMintUrlKey(mintUrl)];
  if (!entry) return true;
  // An answered verdict holds for a day; an unanswered one is re-asked soon.
  const ttl = entry.probedAt == null ? UNPROBED_RECHECK_MS : RECHECK_MS;
  return now - entry.checkedAt > ttl;
}

/**
 * Re-check the given mints when any of them is unchecked or a day stale. One
 * bulk request per `MINT_INFO_MAX_URLS`. A call that arrives while a pass is
 * running waits for it and then re-evaluates ITS OWN mints: the running pass
 * was started for another list (a mint added mid-pass is not in it), so
 * handing back its promise would report that mint as checked when it was not.
 */
export function refreshMintTestnutVerdicts(mintUrls: readonly string[]): Promise<void> {
  if (inflight) return inflight.then(() => refreshMintTestnutVerdicts(mintUrls));
  const now = Date.now();
  if (now - lastFailureAt < FAILURE_BACKOFF_MS) return Promise.resolve();
  if (!mintUrls.some((url) => needsCheck(url, now))) return Promise.resolve();

  inflight = (async () => {
    try {
      for (let i = 0; i < mintUrls.length; i += MINT_INFO_MAX_URLS) {
        const result = await fetchMintInfos(mintUrls.slice(i, i + MINT_INFO_MAX_URLS));
        if (result.isErr()) {
          // fetchJson already logged the network detail; verdicts stand.
          storeLog.warn('store.mint_testnut.refresh_failed', { mintCount: mintUrls.length });
          lastFailureAt = Date.now();
          return;
        }
        useMintTestnutStore.getState().applyMintInfos(result.value);
      }
      storeLog.info('store.mint_testnut.refreshed', { mintCount: mintUrls.length });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Keep verdicts current for the manager's trusted mints: now, on every
 * foreground, and when a mint is added or trusted. Wire once per manager in
 * `CocoProvider`.
 */
export function attachMintTestnutToManager(manager: Manager): () => void {
  const refresh = () => {
    void manager.mint
      .getAllTrustedMints()
      .then((mints) => refreshMintTestnutVerdicts(mints.map((mint) => mint.mintUrl)))
      .catch((error: unknown) => {
        storeLog.warn('store.mint_testnut.refresh_failed', {
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
  };
  storeLog.info('store.mint_testnut.attach_manager');
  manager.on('mint:added', refresh);
  manager.on('mint:trusted', refresh);
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') refresh();
  });
  refresh();
  return () => {
    storeLog.info('store.mint_testnut.detach_manager');
    manager.off('mint:added', refresh);
    manager.off('mint:trusted', refresh);
    appState.remove();
  };
}
