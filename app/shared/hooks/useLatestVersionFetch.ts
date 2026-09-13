import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Application from 'expo-application';
import { getLatestVersion } from '@/shared/lib/apiClient';
import { useBootMorphCompleted } from '@/shared/lib/qrButtonAnchor';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useSettingsHydration, useSettingsStore } from '@/shared/stores/global/settingsStore';

const FETCH_INTERVAL_MS = 6 * 60 * 60 * 1000;
export function useLatestVersionFetch(blockingUpdateShown = false) {
  const bootDone = useBootMorphCompleted();
  const { isOffline } = useOfflineStatus();
  const hydration = useSettingsHydration((state) => state.status);
  const lastAttempt = useRef<number | null>(null);
  const forcedForGate = useRef(false);
  useEffect(() => {
    if (!blockingUpdateShown) forcedForGate.current = false;
    if (!bootDone || hydration !== 'ready' || isOffline) return;
    const controller = new AbortController();
    let inFlight = false;
    let forcedAttempt = false;
    const refresh = async (force = false) => {
      const version = Application.nativeApplicationVersion;
      if (!version || controller.signal.aborted || inFlight) return;
      const now = Date.now();
      const fetchedAt = useSettingsStore.getState().lastKnownAppVersion?.fetchedAt ?? 0;
      const bypassThrottle = force && !forcedForGate.current;
      if (
        !bypassThrottle &&
        now - Math.max(fetchedAt, lastAttempt.current ?? 0) < FETCH_INTERVAL_MS
      )
        return;
      if (bypassThrottle) forcedForGate.current = forcedAttempt = true;
      inFlight = true;
      lastAttempt.current = now;
      const result = await getLatestVersion({ storage: { version }, signal: controller.signal });
      if (controller.signal.aborted) return;
      inFlight = false;
      if (result.isOk())
        useSettingsStore
          .getState()
          .setLastKnownAppVersion({ ...result.value, fetchedAt: Date.now() });
    };
    void refresh(blockingUpdateShown);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      controller.abort();
      if (inFlight) {
        lastAttempt.current = null;
        if (forcedAttempt) forcedForGate.current = false;
      }
      subscription.remove();
    };
  }, [bootDone, hydration, isOffline, blockingUpdateShown]);
}
