import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Application from 'expo-application';
import { getLatestVersion } from '@/shared/lib/apiClient';
import { useBootMorphCompleted } from '@/shared/lib/qrButtonAnchor';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useSettingsHydration, useSettingsStore } from '@/shared/stores/global/settingsStore';

const FETCH_INTERVAL_MS = 6 * 60 * 60 * 1000;
export function useLatestVersionFetch() {
  const bootDone = useBootMorphCompleted();
  const { isOffline } = useOfflineStatus();
  const hydration = useSettingsHydration((state) => state.status);
  const lastAttempt = useRef<number | null>(null);
  useEffect(() => {
    if (!bootDone || hydration !== 'ready' || isOffline) return;
    const controller = new AbortController();
    const refresh = async () => {
      const version = Application.nativeApplicationVersion;
      if (!version || controller.signal.aborted) return;
      const now = Date.now();
      const fetchedAt = useSettingsStore.getState().lastKnownAppVersion?.fetchedAt ?? 0;
      if (now - Math.max(fetchedAt, lastAttempt.current ?? 0) < FETCH_INTERVAL_MS) return;
      lastAttempt.current = now;
      const result = await getLatestVersion({ storage: { version }, signal: controller.signal });
      if (controller.signal.aborted) {
        lastAttempt.current = null;
        return;
      }
      if (result.isOk())
        useSettingsStore
          .getState()
          .setLastKnownAppVersion({ ...result.value, fetchedAt: Date.now() });
    };
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      controller.abort();
      subscription.remove();
    };
  }, [bootDone, hydration, isOffline]);
}
