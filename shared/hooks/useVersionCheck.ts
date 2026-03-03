import { useEffect } from 'react';

import * as Application from 'expo-application';
import semver from 'semver';

import { getLatestVersion } from '@/shared/lib/apiClient';
import { newVersionPopup } from '@/shared/lib/popup';

/**
 * Checks for app updates on mount and shows a popup when a newer version exists.
 */
export const useVersionCheck = () => {
  useEffect(() => {
    const checkForUpdates = async () => {
      const currentVersion = Application.nativeApplicationVersion;
      if (!currentVersion) return;

      const result = await getLatestVersion({
        storage: { version: currentVersion },
      });

      if (!result.isOk()) return;

      const payload = result.value;
      if (
        payload &&
        typeof payload === 'object' &&
        'version' in payload &&
        semver.gt(payload.version, currentVersion)
      ) {
        newVersionPopup({ version: payload.version });
      }
    };

    checkForUpdates();
  }, []);
};
