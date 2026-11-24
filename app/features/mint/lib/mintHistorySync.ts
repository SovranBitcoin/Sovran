/**
 * How `mint-history-store` learns what mints publish, with no server.
 *
 * - `observeMintInfoResponse` is the one way in. Every validated direct
 *   `GET /v1/info` (`fetchMintInfo`) and every mint-info refresh Coco reports
 *   (`mint:added` / `mint:updated`) hands it the document; it canonicalizes,
 *   waits for the store's load, checks the profile is still the one the
 *   request was made for, and records a baseline, a revision or nothing.
 * - `checkMintInfoNow` asks one mint directly, single-flight per mint and
 *   profile: the history screen's pull-to-refresh and the sweep share it.
 * - `startMintHistorySweep` checks the wallet's mints in the background: after
 *   the account's stores load, three at a time, each again 24h after a
 *   success or after a 5 min .. 24 h jittered backoff on failure, and again
 *   when the app comes to the foreground or the network comes back. It never
 *   blocks startup and stops on a profile switch.
 *
 * Fenced: every write checks both the profile it started for and the session
 * generation, which moves on every sweep stop (a profile switch, a provider
 * remount) and on Delete All. An answer for A that lands after A → B → A, or
 * after Delete All has cleared storage, writes nothing.
 */
import type { Manager } from '@cashu/coco-core';
import { AppState } from 'react-native';
import * as Network from 'expo-network';

import { ownEntry } from '@/shared/lib/ownEntry';
import { fetchMintInfo } from '@/shared/lib/apiClient';
import { registerProfileSwitchService } from '@/shared/lib/account/accountRegistry';
import { onDataReset } from '@/shared/lib/account/dataResetFence';
import { storeLog } from '@/shared/lib/logger';
import { whenLoaded } from '@/shared/lib/persist/hydrationOutcome';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { activePubkey } from '@/shared/stores/global/profileStore';
import {
  useMintHistoryStore,
  type MintObservationOutcome,
} from '@/shared/stores/profile/mintHistoryStore';
import { canonicalizeMintInfo } from './mintChanges/localDiff';

/** How many mints the sweep asks at once. */
export const SWEEP_CONCURRENCY = 3;
/** The sweep does not start until the app has had this long to settle. */
const SWEEP_START_DELAY_MS = 5_000;
/** Bounds on how long the sweep sleeps before looking for due mints again. */
const SWEEP_MIN_SLEEP_MS = 60_000;
const SWEEP_MAX_SLEEP_MS = 24 * 60 * 60 * 1000;

type ObservationResult = MintObservationOutcome | 'skipped';

type MintCheckResult = { ok: true } | { ok: false; error: Error };

const inflight = new Map<string, Promise<MintCheckResult>>();

/** Moves on every stop and every Delete All; a write from an older one is dropped. */
let syncGeneration = 0;

/** Starts a new session: writes begun before it are dropped, running checks are forgotten. */
function resetMintHistorySync(): void {
  syncGeneration += 1;
  inflight.clear();
}
onDataReset(resetMintHistorySync);

/** The current session generation, for a caller that starts a request before it observes. */
export function mintHistoryGeneration(): number {
  return syncGeneration;
}

/** Whether a write begun for `owner` in `generation` may still land. */
const current = (owner: string, generation: number) =>
  generation === syncGeneration && activePubkey() === owner;

/**
 * Record what a mint said in answer to `/v1/info`. `owner` and `generation`
 * are the profile and session the request was made in (the current ones when
 * it started); the answer is dropped if either has changed by the time it can
 * be written.
 */
export async function observeMintInfoResponse(
  mintUrl: string,
  rawInfo: unknown,
  options: { owner?: string; generation?: number; nowMs?: number } = {}
): Promise<ObservationResult> {
  const owner = options.owner ?? activePubkey();
  if (!owner) return 'skipped';
  const generation = options.generation ?? syncGeneration;
  const info = canonicalizeMintInfo(rawInfo);
  if (!info) return 'skipped';
  const loaded = await whenLoaded(useMintHistoryStore);
  if (!loaded || !current(owner, generation)) return 'skipped';
  return useMintHistoryStore.getState().recordObservation(mintUrl, info, options.nowMs);
}

async function recordFailure(mintUrl: string, owner: string, generation: number): Promise<void> {
  const loaded = await whenLoaded(useMintHistoryStore);
  if (!loaded || !current(owner, generation)) return;
  useMintHistoryStore.getState().recordFailure(mintUrl);
}

/**
 * Ask a mint for its info now. A check already running for the same mint and
 * profile is joined, not repeated. The answer is recorded by `fetchMintInfo`'s
 * own call to `observeMintInfoResponse`; a failure is recorded here, keeping
 * the saved baseline and history.
 */
export function checkMintInfoNow(
  mintUrl: string,
  options: { signal?: AbortSignal; fetch?: typeof fetchMintInfo } = {}
): Promise<MintCheckResult> {
  const owner = activePubkey();
  if (!owner) return Promise.resolve({ ok: false, error: new Error('No active profile') });
  const slot = `${owner}|${normalizeMintUrlKey(mintUrl)}`;
  const running = inflight.get(slot);
  if (running) return running;
  const fetcher = options.fetch ?? fetchMintInfo;
  const generation = syncGeneration;
  const promise = (async (): Promise<MintCheckResult> => {
    const result = await fetcher(mintUrl, { signal: options.signal });
    if (result.isOk()) return { ok: true };
    if (!options.signal?.aborted) await recordFailure(mintUrl, owner, generation);
    return { ok: false, error: result.error };
  })().finally(() => {
    if (inflight.get(slot) === promise) inflight.delete(slot);
  });
  inflight.set(slot, promise);
  return promise;
}

/**
 * Mints the sweep should ask now: never checked, or past their next check. A
 * mint that has never answered waits out its failure backoff like any other.
 */
export function dueMintUrls(mintUrls: readonly string[], nowMs: number): string[] {
  const held = useMintHistoryStore.getState().byMintUrl;
  return mintUrls.filter((url) => {
    const nextRetryAt = ownEntry(held, normalizeMintUrlKey(url))?.nextRetryAt;
    return nextRetryAt === undefined || nextRetryAt <= nowMs;
  });
}

async function runPool(
  urls: readonly string[],
  limit: number,
  task: (url: string) => Promise<void>
) {
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++]!;
      await task(url);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, worker));
}

interface SweepOptions {
  /** The wallet's mints, from Coco. */
  trustedMintUrls: () => Promise<string[]>;
  check?: typeof checkMintInfoNow;
  /** Calls `resume` on foreground and on network return; returns its stop. */
  subscribeResume?: (resume: () => void) => () => void;
  startDelayMs?: number;
  now?: () => number;
}

function defaultSubscribeResume(resume: () => void): () => void {
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') resume();
  });
  let wasOffline = false;
  const network = Network.addNetworkStateListener((state) => {
    const offline = state.isConnected === false || state.isInternetReachable === false;
    if (wasOffline && !offline) resume();
    wasOffline = offline;
  });
  return () => {
    appState.remove();
    network.remove();
  };
}

/**
 * Keep the wallet's mints' history current in the background. Returns its
 * stop, which also runs on a profile switch; a check that finishes after a
 * stop or a switch writes nothing.
 */
export function startMintHistorySweep(options: SweepOptions): () => void {
  const owner = activePubkey();
  const check = options.check ?? checkMintInfoNow;
  const now = options.now ?? Date.now;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let again = false;

  const alive = () => !controller.signal.aborted && !!owner && activePubkey() === owner;

  const schedule = (delayMs: number) => {
    if (timer) clearTimeout(timer);
    if (!alive()) return;
    timer = setTimeout(() => void run(), delayMs);
  };

  const sweep = async () => {
    const loaded = await whenLoaded(useMintHistoryStore);
    if (!loaded || !alive()) return;
    const urls = await options.trustedMintUrls();
    if (!alive()) return;
    useMintHistoryStore.getState().setTrustedMints(urls);
    const due = dueMintUrls(urls, now());
    if (due.length > 0) storeLog.info('store.mint_history.sweep', { due: due.length });
    await runPool(due, SWEEP_CONCURRENCY, async (url) => {
      if (!alive()) return;
      await check(url, { signal: controller.signal });
    });
    if (!alive()) return;
    const held = useMintHistoryStore.getState().byMintUrl;
    const nextAt = urls
      .map((url) => ownEntry(held, normalizeMintUrlKey(url))?.nextRetryAt)
      .filter((at): at is number => typeof at === 'number');
    const sleep = nextAt.length ? Math.min(...nextAt) - now() : SWEEP_MAX_SLEEP_MS;
    schedule(Math.min(SWEEP_MAX_SLEEP_MS, Math.max(SWEEP_MIN_SLEEP_MS, sleep)));
  };

  const run = (): Promise<void> => {
    if (!alive()) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = sweep()
      .catch((error: unknown) => {
        storeLog.warn('store.mint_history.sweep_failed', {
          error: error instanceof Error ? error : new Error(String(error)),
        });
        schedule(SWEEP_MIN_SLEEP_MS);
      })
      .finally(() => {
        running = undefined;
        if (again && alive()) {
          again = false;
          void run();
        }
      });
    return running;
  };

  const stopResume = (options.subscribeResume ?? defaultSubscribeResume)(() => void run());
  schedule(options.startDelayMs ?? SWEEP_START_DELAY_MS);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    resetMintHistorySync();
    controller.abort();
    if (timer) clearTimeout(timer);
    stopResume();
    unregister();
  };
  const unregister = registerProfileSwitchService('mint.history.sweep', stop);
  return stop;
}

/**
 * Wire one Coco manager: its mint-info refreshes are observations, and its
 * trusted mints are what the sweep checks. Called once per manager in
 * `CocoProvider`, which remounts per account.
 */
export function attachMintHistoryToManager(manager: Manager): () => void {
  const onMint = ({ mint }: { mint: { mintUrl: string; mintInfo?: unknown } }) => {
    if (mint?.mintUrl && mint.mintInfo) void observeMintInfoResponse(mint.mintUrl, mint.mintInfo);
  };
  manager.on('mint:added', onMint);
  manager.on('mint:updated', onMint);
  const stopSweep = startMintHistorySweep({
    trustedMintUrls: async () =>
      (await manager.mint.getAllTrustedMints()).map((mint) => mint.mintUrl),
  });
  return () => {
    manager.off('mint:added', onMint);
    manager.off('mint:updated', onMint);
    stopSweep();
  };
}
