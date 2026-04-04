import AsyncStorage from '@react-native-async-storage/async-storage';
import { log } from '@/shared/lib/logger';
import { useSettingsStore } from './settingsStore';

/**
 * Migration script to move settings from Redux to Zustand
 * This should be run once during app startup
 */
export const migrateSettingsFromRedux = async (reduxState?: any) => {
  try {
    log.info('settings.migration.start');

    // Check if we already have Zustand settings
    const existingZustandSettings = await AsyncStorage.getItem('settings-store');
    if (existingZustandSettings) {
      log.debug('settings.migration.already_exists');
      return;
    }

    let settings;

    if (reduxState) {
      // Use the provided Redux state (from migration context)
      settings = reduxState.settings?.settings;
      log.debug('settings.migration.using_redux_state', { settings });
    } else {
      // Try to get Redux settings from AsyncStorage
      const reduxSettings = await AsyncStorage.getItem('persist:root');
      if (!reduxSettings) {
        log.debug('settings.migration.no_redux_settings');
        return;
      }

      const parsedReduxSettings = JSON.parse(reduxSettings);
      settings = parsedReduxSettings.settings?.settings;
      log.debug('settings.migration.found_redux_settings', { settings });
    }

    if (!settings) {
      log.debug('settings.migration.no_settings_in_redux');
      return;
    }

    // Migrate the settings
    const zustandStore = useSettingsStore.getState();

    // Set theme (unified with background image)
    if (settings.theme) {
      log.debug('settings.migration.theme', { theme: settings.theme });
      zustandStore.setTheme(settings.theme);
    }

    // Set language
    if (settings.lang) {
      log.debug('settings.migration.language', { lang: settings.lang });
      zustandStore.setLanguage(settings.lang);
    }

    // Set display BTC
    if (settings.display_btc !== undefined) {
      log.debug('settings.migration.display_btc', { displayBtc: settings.display_btc });
      zustandStore.setDisplayBtc(settings.display_btc);
    }

    // Set experimental
    if (settings.experimental !== undefined) {
      log.debug('settings.migration.experimental', { experimental: settings.experimental });
      zustandStore.setExperimental(settings.experimental);
    }

    // Set terms accepted
    if (settings.termsAccepted) {
      log.debug('settings.migration.terms_accepted', { termsAccepted: settings.termsAccepted });
      zustandStore.acceptTerms(settings.termsAccepted.date);
    }

    // Note: Passcode is not migrated for security reasons

    log.info('settings.migration.done');
  } catch (error) {
    log.error('settings.migration.failed', { error });
  }
};
