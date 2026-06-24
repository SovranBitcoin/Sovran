import AsyncStorage from '@react-native-async-storage/async-storage';
import { redactError, storeLog } from '@/shared/lib/logger';
import { useSettingsStore } from './settingsStore';

/**
 * Migration script to move settings from Redux to Zustand
 * This should be run once during app startup
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reads the legacy persisted Redux blob whose historical shape predates the current stores (cf. redux/*.deprecated.ts); typing it would be churn on migration scaffolding slated for removal.
export const migrateSettingsFromRedux = async (reduxState?: any) => {
  try {
    storeLog.info('settings.migration.start');

    // Check if we already have Zustand settings
    const existingZustandSettings = await AsyncStorage.getItem('settings-store');
    if (existingZustandSettings) {
      storeLog.debug('settings.migration.already_exists');
      return;
    }

    let settings;

    if (reduxState) {
      // Use the provided Redux state (from migration context)
      settings = reduxState.settings?.settings;
    } else {
      // Try to get Redux settings from AsyncStorage
      const reduxSettings = await AsyncStorage.getItem('persist:root');
      if (!reduxSettings) {
        storeLog.debug('settings.migration.no_redux_settings');
        return;
      }

      const parsedReduxSettings = JSON.parse(reduxSettings);
      settings = parsedReduxSettings.settings?.settings;
    }

    if (!settings) {
      storeLog.debug('settings.migration.no_settings_in_redux');
      return;
    }

    // Never log the full `settings` object: legacy Redux state can carry a
    // plaintext passcode, and the ring buffer is exfiltrable via dumpForLLM.
    // Log only field presence so the migration is debuggable without leakage.
    storeLog.debug('settings.migration.found_redux_settings', {
      source: reduxState ? 'context' : 'async_storage',
      has: {
        lang: !!settings.lang,
        display_btc: settings.display_btc !== undefined,
        experimental: settings.experimental !== undefined,
        termsAccepted: !!settings.termsAccepted,
      },
    });

    // Migrate the settings
    const zustandStore = useSettingsStore.getState();

    // Note: Legacy Redux `settings.theme` is intentionally dropped —
    // theme is now profile-scoped in `themeStore`. Any existing settings
    // under the legacy Zustand key are migrated by `globalMigrations.ts`.

    // Set language
    if (settings.lang) {
      storeLog.debug('settings.migration.language', { lang: settings.lang });
      zustandStore.setLanguage(settings.lang);
    }

    // Set display BTC
    if (settings.display_btc !== undefined) {
      storeLog.debug('settings.migration.display_btc', { displayBtc: settings.display_btc });
      zustandStore.setDisplayBtc(settings.display_btc);
    }

    // Set experimental
    if (settings.experimental !== undefined) {
      storeLog.debug('settings.migration.experimental', { experimental: settings.experimental });
      zustandStore.setExperimental(settings.experimental);
    }

    // Set terms accepted — log only the date, never the wider structure.
    if (settings.termsAccepted) {
      storeLog.debug('settings.migration.terms_accepted', {
        date: settings.termsAccepted.date,
      });
      zustandStore.acceptTerms(settings.termsAccepted.date);
    }

    // Note: Passcode is not migrated for security reasons

    storeLog.info('settings.migration.done');
  } catch (error) {
    storeLog.error('settings.migration.failed', { error: redactError(error) });
  }
};
