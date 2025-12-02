import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BACKGROUND_THEME_NAMES,
  isBackgroundImageTheme,
  getBackgroundImage,
} from 'config/backgroundImageThemes';

export interface TermsAccepted {
  termsAccepted: boolean;
  date: string;
}

export type DisplayCurrency = 'usd' | 'eur' | 'gbp';

export interface SettingsState {
  // Core settings
  theme: string;
  language: string;
  displayBtc: number;
  displayCurrency: DisplayCurrency;
  passcode: string;
  experimental: boolean;
  termsAccepted: TermsAccepted | null;
  quickAccessP2PK: boolean;
}

interface SettingsActions {
  // Theme management (unified theme and background image)
  setTheme: (theme: string) => void;
  getTheme: () => string;

  // Language management
  setLanguage: (language: string) => void;
  getLanguage: () => string;

  // Display settings
  setDisplayBtc: (display: number) => void;
  getDisplayBtc: () => number;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
  getDisplayCurrency: () => DisplayCurrency;

  // Passcode management
  setPasscode: (passcode: string) => void;
  getPasscode: () => string;
  clearPasscode: () => void;

  // Experimental features
  setExperimental: (experimental: boolean) => void;
  getExperimental: () => boolean;

  // Terms acceptance
  acceptTerms: (date: string) => void;
  getTermsAccepted: () => TermsAccepted | null;
  isTermsAccepted: () => boolean;

  // P2PK quick access
  setQuickAccessP2PK: (enabled: boolean) => void;
  getQuickAccessP2PK: () => boolean;

  // Utility methods
  getAllSettings: () => SettingsState;
  resetSettings: () => void;
  clearAllData: () => Promise<void>;
}

type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      // Initial state
      theme: 'dark',
      language: 'en',
      displayBtc: 3,
      displayCurrency: 'usd',
      passcode: '',
      experimental: false,
      termsAccepted: null,
      quickAccessP2PK: false,

      // Theme management
      setTheme: (theme: string) => {
        console.log('SettingsStore: setTheme called with:', theme);
        set({ theme });
      },

      getTheme: () => {
        const theme = get().theme;
        console.log('SettingsStore: getTheme called, returning:', theme);
        return theme;
      },

      // Language management
      setLanguage: (language: string) => {
        console.log('SettingsStore: setLanguage called with:', language);
        set({ language });
      },

      getLanguage: () => {
        const language = get().language;
        console.log('SettingsStore: getLanguage called, returning:', language);
        return language;
      },

      // Display settings
      setDisplayBtc: (display: number) => {
        set({ displayBtc: display });
      },

      getDisplayBtc: () => {
        const displayBtc = get().displayBtc;
        return displayBtc;
      },

      setDisplayCurrency: (currency: DisplayCurrency) => {
        set({ displayCurrency: currency });
      },

      getDisplayCurrency: () => {
        return get().displayCurrency;
      },

      // Passcode management
      setPasscode: (passcode: string) => {
        set({ passcode });
      },

      getPasscode: () => {
        const passcode = get().passcode;
        return passcode;
      },

      clearPasscode: () => {
        set({ passcode: '' });
      },

      // Experimental features
      setExperimental: (experimental: boolean) => {
        set({ experimental });
      },

      getExperimental: () => {
        const experimental = get().experimental;
        return experimental;
      },

      // Terms acceptance
      acceptTerms: (date: string) => {
        set({
          termsAccepted: {
            termsAccepted: true,
            date,
          },
        });
      },

      getTermsAccepted: () => {
        const termsAccepted = get().termsAccepted;
        return termsAccepted;
      },

      isTermsAccepted: () => {
        const termsAccepted = get().termsAccepted;
        const isAccepted = termsAccepted?.termsAccepted === true;
        console.log('SettingsStore: isTermsAccepted called, returning:', isAccepted);
        return isAccepted;
      },

      // P2PK quick access
      setQuickAccessP2PK: (enabled: boolean) => {
        set({ quickAccessP2PK: enabled });
      },

      getQuickAccessP2PK: () => {
        return get().quickAccessP2PK;
      },

      // Utility methods
      getAllSettings: () => {
        const state = get();
        console.log('SettingsStore: getAllSettings called, returning:', state);
        return state;
      },

      resetSettings: () => {
        console.log('SettingsStore: resetSettings called');
        set({
          theme: 'dark',
          language: 'en',
          displayBtc: 3,
          displayCurrency: 'usd',
          passcode: '',
          experimental: false,
          termsAccepted: null,
          quickAccessP2PK: false,
        });
      },

      // Clear all data from both state and storage
      clearAllData: async () => {
        try {
          console.log('SettingsStore: clearAllData called');
          // Clear from AsyncStorage
          await AsyncStorage.removeItem('settings-store');
          // Reset state to initial values
          set({
            theme: 'dark',
            language: 'en',
            displayBtc: 3,
            displayCurrency: 'usd',
            passcode: '',
            experimental: false,
            termsAccepted: null,
            quickAccessP2PK: false,
          });
          console.log('SettingsStore: All data cleared successfully');
        } catch (error) {
          console.error('SettingsStore: Error clearing data:', error);
          throw error;
        }
      },
    }),
    {
      name: 'settings-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the core settings, not sensitive data like passcode
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        displayBtc: state.displayBtc,
        displayCurrency: state.displayCurrency,
        experimental: state.experimental,
        termsAccepted: state.termsAccepted,
        quickAccessP2PK: state.quickAccessP2PK,
        // Note: passcode is not persisted for security reasons
      }),
      onRehydrateStorage: () => (state, error) => {
        console.log('SettingsStore: onRehydrateStorage called with state:', state, 'error:', error);
        if (error) {
          console.warn('SettingsStore: Failed to rehydrate from storage:', error);
        } else {
          console.log('SettingsStore: Successfully rehydrated from storage:', state);
        }
      },
    }
  )
);

// Re-export background image helpers from the config file
export { BACKGROUND_THEME_NAMES, isBackgroundImageTheme, getBackgroundImage };

// Legacy helper for backwards compatibility
export const getBackgroundImageForTheme = (theme: string): string | null => {
  return isBackgroundImageTheme(theme) ? theme : null;
};
