import { ResultAsync } from 'neverthrow';
import { getAiLineup } from '@/shared/lib/apiClient';
import { aiLog } from '@/shared/lib/logger';
import { lineupFromNaggPayload } from './lineup';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';

const DAY_MS = 24 * 60 * 60 * 1000;
const FAILURE_REFRESH_MS = 5 * 60 * 1000;
let inFlight: { profile: number; promise: Promise<boolean> } | null = null;
let lastAttempt: { profile: number; at: number; forcedAt: number | null } | null = null;

/** One refresh owner for mount/foreground and failed-node recovery. Returns
 * whether a usable server lineup landed; never rejects or logs upstream text. */
export function refreshRoutstrLineup(
  reason: 'foreground' | 'failure' = 'foreground'
): Promise<boolean> {
  const profile = useProfileStore.getState().activeAccountIndex;
  if (inFlight?.profile === profile) return inFlight.promise;
  const state = useRoutstrStore.getState();
  const now = Date.now();
  const previous = lastAttempt?.profile === profile ? lastAttempt : null;
  if (reason === 'foreground') {
    if (state.serverLineupAt != null && now - state.serverLineupAt <= DAY_MS)
      return Promise.resolve(false);
    if (previous && now - previous.at <= DAY_MS) return Promise.resolve(false);
  } else if (previous?.forcedAt != null && now - previous.forcedAt < FAILURE_REFRESH_MS) {
    return Promise.resolve(false);
  }
  lastAttempt = {
    profile,
    at: now,
    forcedAt: reason === 'failure' ? now : (previous?.forcedAt ?? null),
  };
  const node = state.nodeBaseUrl;
  const serverLineupAt = state.serverLineupAt;
  const ownsRequest = () =>
    useProfileStore.getState().activeAccountIndex === profile &&
    useRoutstrStore.getState().nodeBaseUrl === node &&
    (useRoutstrStore.getState().serverLineupAt === serverLineupAt ||
      useRoutstrStore.getState().serverLineupAt == null);
  const promise = Promise.resolve(
    ResultAsync.fromPromise(
      Promise.resolve().then(() => getAiLineup()),
      () => undefined
    )
  ).then((result) => {
    if (!ownsRequest()) return false;
    if (result.isOk() && result.value.isOk()) {
      const mapped = lineupFromNaggPayload(result.value.value);
      if (mapped.lineup) {
        useRoutstrStore.getState().setServerLineup({ ...mapped, lineup: mapped.lineup });
        return true;
      }
    }
    aiLog.warn('routstr.lineup.refresh_failed');
    if (serverLineupAt != null && now - serverLineupAt > 7 * DAY_MS) {
      const current = useRoutstrStore.getState();
      current.invalidateServerLineup();
      if (current.modelsCache) current.setCachedModels(current.modelsCache.data);
    }
    return false;
  });
  const request = { profile, promise };
  inFlight = request;
  void request.promise.finally(() => {
    if (inFlight === request) inFlight = null;
  });
  return request.promise;
}
