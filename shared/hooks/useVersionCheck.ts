import { useEffect } from 'react';

import * as Application from 'expo-application';
import semver from 'semver';

import { getLatestVersion } from '@/shared/lib/apiClient';
import { paramPopup } from '@/shared/lib/popup';
import { log } from '@/shared/lib/logger';
import { useBootMorphCompleted } from '@/shared/lib/qrButtonAnchor';

/**
 * Checks for app updates and shows a popup when a newer version exists.
 *
 * Deferred until after the boot splash → QR-button morph completes so the
 * version-check API call doesn't compete with first-paint network/CPU
 * work. Holding the new-version popup 1–2 extra seconds while the wallet
 * renders is fine.
 */
export const useVersionCheck = () => {
  const bootDone = useBootMorphCompleted();
  useEffect(() => {
    if (!bootDone) return;
    const controller = new AbortController();
    const checkForUpdates = async () => {
      const currentVersion = Application.nativeApplicationVersion;
      if (!currentVersion) {
        log.warn('hook.version_check.no_native_version');
        return;
      }

      log.debug('hook.version_check.start', { currentVersion });

      const result = await getLatestVersion({
        storage: { version: currentVersion },
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      if (!result.isOk()) {
        log.warn('hook.version_check.api_error', { currentVersion });
        return;
      }

      const payload = result.value;
      if (
        payload &&
        typeof payload === 'object' &&
        'version' in payload &&
        semver.gt(payload.version, currentVersion)
      ) {
        log.info('hook.version_check.update_available', {
          currentVersion,
          latestVersion: payload.version,
          hasMessage: !!payload.message,
        });
        paramPopup('new-version', { version: payload.version, message: payload.message });
      } else {
        log.debug('hook.version_check.up_to_date', { currentVersion });
      }
    };

    void checkForUpdates();
    return () => controller.abort();
  }, [bootDone]);
};
