import { useEffect } from 'react';

import * as Application from 'expo-application';
import semver from 'semver';

import { getLatestVersion } from '@/shared/lib/apiClient';
import { newVersionPopup } from '@/shared/lib/popup';
import { log } from '@/shared/lib/logger';

/**
 * Checks for app updates on mount and shows a popup when a newer version exists.
 */
export const useVersionCheck = () => {
  useEffect(() => {
    const checkForUpdates = async () => {
      const currentVersion = Application.nativeApplicationVersion;
      if (!currentVersion) {
        log.warn('hook.version_check.no_native_version');
        return;
      }

      log.debug('hook.version_check.start', { currentVersion });

      const result = await getLatestVersion({
        storage: { version: currentVersion },
      });

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
        });
        newVersionPopup({ version: payload.version });
      } else {
        log.debug('hook.version_check.up_to_date', { currentVersion });
      }
    };

    checkForUpdates();
  }, []);
};
