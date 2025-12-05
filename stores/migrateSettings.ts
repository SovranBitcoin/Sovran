import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettingsStore } from './settingsStore';

/**
 * Migration script to move settings from Redux to Zustand
 * This should be run once during app startup
 */
export const migrateSettingsFromRedux = async (reduxState?: any) => {
  try {
    console.log('SettingsMigration: Starting migration from Redux to Zustand...');

    // Check if we already have Zustand settings
    const existingZustandSettings = await AsyncStorage.getItem('settings-store');
    if (existingZustandSettings) {
      console.log('SettingsMigration: Zustand settings already exist, skipping migration');
      return;
    }

    let settings;

    if (reduxState) {
      // Use the provided Redux state (from migration context)
      settings = reduxState.settings?.settings;
      console.log('SettingsMigration: Using provided Redux state:', settings);
    } else {
      // Try to get Redux settings from AsyncStorage
      const reduxSettings = await AsyncStorage.getItem('persist:root');
      if (!reduxSettings) {
        console.log('SettingsMigration: No Redux settings found, using defaults');
        return;
      }

      const parsedReduxSettings = JSON.parse(reduxSettings);
      settings = parsedReduxSettings.settings?.settings;
      console.log('SettingsMigration: Found Redux settings from storage:', settings);
    }

    if (!settings) {
      console.log('SettingsMigration: No settings found in Redux data');
      return;
    }

    // Migrate the settings
    const zustandStore = useSettingsStore.getState();

    // Set theme (unified with background image)
    if (settings.theme) {
      console.log('SettingsMigration: Migrating theme:', settings.theme);
      zustandStore.setTheme(settings.theme);
    }

    // Set language
    if (settings.lang) {
      console.log('SettingsMigration: Migrating language:', settings.lang);
      zustandStore.setLanguage(settings.lang);
    }

    // Set display BTC
    if (settings.display_btc !== undefined) {
      console.log('SettingsMigration: Migrating display_btc:', settings.display_btc);
      zustandStore.setDisplayBtc(settings.display_btc);
    }

    // Set experimental
    if (settings.experimental !== undefined) {
      console.log('SettingsMigration: Migrating experimental:', settings.experimental);
      zustandStore.setExperimental(settings.experimental);
    }

    // Set terms accepted
    if (settings.termsAccepted) {
      console.log('SettingsMigration: Migrating termsAccepted:', settings.termsAccepted);
      zustandStore.acceptTerms(settings.termsAccepted.date);
    }

    // Note: Passcode is not migrated for security reasons

    console.log('SettingsMigration: Migration completed successfully');
  } catch (error) {
    console.error('SettingsMigration: Error during migration:', error);
  }
};
