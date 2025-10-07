import { useEffect } from 'react';
import { getLatestVersion } from 'helper/apiClient';
import { getStructure, store } from 'redux/store';
import { popup } from 'helper/popup';
import semver from 'semver';
import { version } from 'app/settings-pages';

/**
 * Custom hook to check for app version updates
 * Automatically checks for updates on mount and shows a popup if a newer version is available
 */
export const useVersionCheck = () => {
  useEffect(() => {
    const checkForUpdates = async () => {
      if (!version) return;

      const latestVersionResult = await getLatestVersion({
        storage: {
          version: version,
          store: getStructure(store.getState()),
        },
      });

      if (latestVersionResult.isOk()) {
        if (
          latestVersionResult.value &&
          typeof latestVersionResult.value === 'object' &&
          'version' in latestVersionResult.value
        ) {
          if (semver.gt(latestVersionResult.value.version, version)) {
            popup({
              message: 'latest_version',
              params: {
                version: latestVersionResult.value.version,
              },
            });
          }
        }
      }
    };

    checkForUpdates();
  }, []);
};
