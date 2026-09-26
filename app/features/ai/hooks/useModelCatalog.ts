import { useCallback, useEffect, useRef, useState } from 'react';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';

import { getModels, type RoutstrModel } from '@/shared/lib/routstr/api';
import { refreshCuratedModels } from '@/shared/lib/routstr/curatedModels';
import { useVisualActivityEffect } from '@/shared/hooks/useVisualActivityEffect';
import { aiLog, redactError } from '@/shared/lib/logger';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

/**
 * Owner of the app's only `/v1/models` read.
 *
 * The fetch used to live inline in `ModelChip`'s mount effect, and its
 * rejection went into a bare `.catch(() => {})`. Nothing in that effect's
 * dependencies changes when a request fails, so the first failure was the last
 * attempt: the lineup stayed null until the component remounted or the user
 * changed node. For a user pinned to one provider that is terminal — the nagg
 * lineup path correctly refuses a lineup derived for a different node, so the
 * catalog read is the ONLY thing that can repair the menu, and it had given up
 * silently.
 *
 * This hook is that missing owner. It keeps the same success contract (a
 * landed catalog goes through `setCachedModels`, which derives the lineup and
 * persists the compact snapshot) and adds the three things the inline version
 * lacked: the failure is logged rather than swallowed, it is retried on a
 * bounded ladder, and every timer is cancelled on unmount or node change.
 *
 * Deliberately separate from `refreshRoutstrLineup`, which owns the nagg
 * *lineup* endpoint and its own foreground/failure throttles. These are two
 * different upstreams with different failure modes; one throttle cannot be
 * honest about both.
 */

/**
 * Delay before each retry, in order. The ladder is the whole retry policy:
 * finite by construction, so there is no loop to bound separately, and short
 * at the front because the common case is a request that raced app start or a
 * network that came back within seconds.
 *
 * Total span is a little over six minutes. Past that a foreground return is a
 * better trigger than a timer — the user is looking at the screen again, and
 * whatever was wrong has had as long as they were away to clear.
 */
const CATALOG_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000, 300_000] as const;

/**
 * The models this node has served, or `[]` while none have.
 *
 * Returns the array rather than a status object on purpose: the picker already
 * owns the vocabulary for "loading" versus "answered with nothing" and reads it
 * from the store's `modelsCache`, which this hook writes through. A second,
 * hook-local copy of that distinction would be a second place for it to drift.
 */
export function useModelCatalog(): RoutstrModel[] {
  const nodeBaseUrl = useRoutstrStore((s) => s.nodeBaseUrl);
  const cachedModels = useRoutstrStore((s) => s.modelsCache?.data ?? null);
  const setCachedModels = useRoutstrStore((s) => s.setCachedModels);
  const isCacheStale = useRoutstrStore((s) => s.isCacheStale);

  const [models, setModels] = useState<RoutstrModel[]>(cachedModels ?? []);

  // Routstr's curated list rides beside the catalog read: the catalog says
  // what the node serves, the list says what the network still stands behind,
  // and the lineup is derived from both. Throttled by the store's own TTL, so
  // this is one relay round-trip every few hours, not one per mount.
  const { ndk } = useNDK();
  useEffect(() => {
    if (ndk) void refreshCuratedModels(ndk);
  }, [ndk]);
  /**
   * Bumped to start a fresh ladder. The effect below re-runs on it, which is
   * the one way a new attempt happens after the ladder has run out — and it
   * only ever moves when something outside the ladder says the situation may
   * have changed.
   */
  const [retryEpoch, setRetryEpoch] = useState(0);
  /** True once a ladder has been exhausted with no catalog to show for it. */
  const exhausted = useRef(false);

  useEffect(() => {
    if (cachedModels && !isCacheStale()) {
      setModels(cachedModels);
      return;
    }
    exhausted.current = false;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    // Node changes are not cancellations of this effect (the store write lands
    // before React re-renders), so every continuation re-checks that the node
    // it was started for is still the one in play before touching state.
    const stillOurs = () => !cancelled && useRoutstrStore.getState().nodeBaseUrl === nodeBaseUrl;

    const run = (): void => {
      void getModels()
        .then((next) => {
          if (!stillOurs()) return;
          setCachedModels(next);
          setModels(next);
        })
        .catch((error: unknown) => {
          if (!stillOurs()) return;
          const retryInMs = CATALOG_RETRY_DELAYS_MS[attempt] ?? null;
          // Observable by construction. A swallowed rejection here is
          // indistinguishable in the logs from a node that answers with an
          // empty catalog, and the two need opposite fixes.
          aiLog.warn('ai.catalog.fetch_failed', {
            nodeBaseUrl,
            attempt: attempt + 1,
            attemptsRemaining: CATALOG_RETRY_DELAYS_MS.length - attempt,
            retryInMs,
            error: redactError(error),
          });
          if (retryInMs == null) {
            // Ladder spent. Stop rather than keep asking — a node that has
            // refused six times over six minutes is not one more request away.
            exhausted.current = true;
            return;
          }
          attempt += 1;
          timer = setTimeout(run, retryInMs);
        });
    };
    run();

    return () => {
      cancelled = true;
      if (timer != null) clearTimeout(timer);
    };
  }, [cachedModels, isCacheStale, nodeBaseUrl, retryEpoch, setCachedModels]);

  // Returning to a screen (or to the app) with no catalog is the one signal
  // worth a fresh ladder: time has passed, and the user is here to use the
  // thing that is broken. Guarded on `exhausted` so an in-flight ladder is
  // never restarted out from under itself, which would be the unbounded loop.
  const onVisible = useCallback(() => {
    if (exhausted.current) setRetryEpoch((n) => n + 1);
  }, []);
  useVisualActivityEffect(onVisible);

  return models;
}
