import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface TermsAccepted {
  termsAccepted: boolean;
  date: string;
}

export interface SettingsState {
  // Core settings
  theme: string;
  language: string;
  displayBtc: number;
  passcode: string;
  experimental: boolean;
  termsAccepted: TermsAccepted | null;
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

  // Utility methods
  getAllSettings: () => SettingsState;
  resetSettings: () => void;
  clearAllData: () => Promise<void>;
}

type SettingsStore = SettingsState & SettingsActions;

// Background image themes that should be treated as background images
const BACKGROUND_IMAGE_THEMES = ['royalpurple', 'mysticblue', 'cosmicpurple', 'deepocean'];

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      // Initial state
      theme: 'dark',
      language: 'en',
      displayBtc: 3,
      passcode: '',
      experimental: false,
      termsAccepted: null,

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
        console.log('SettingsStore: setDisplayBtc called with:', display);
        set({ displayBtc: display });
      },

      getDisplayBtc: () => {
        const displayBtc = get().displayBtc;
        console.log('SettingsStore: getDisplayBtc called, returning:', displayBtc);
        return displayBtc;
      },

      // Passcode management
      setPasscode: (passcode: string) => {
        console.log('SettingsStore: setPasscode called');
        set({ passcode });
      },

      getPasscode: () => {
        const passcode = get().passcode;
        console.log('SettingsStore: getPasscode called, returning:', passcode ? '[HIDDEN]' : '');
        return passcode;
      },

      clearPasscode: () => {
        console.log('SettingsStore: clearPasscode called');
        set({ passcode: '' });
      },

      // Experimental features
      setExperimental: (experimental: boolean) => {
        console.log('SettingsStore: setExperimental called with:', experimental);
        set({ experimental });
      },

      getExperimental: () => {
        const experimental = get().experimental;
        console.log('SettingsStore: getExperimental called, returning:', experimental);
        return experimental;
      },

      // Terms acceptance
      acceptTerms: (date: string) => {
        console.log('SettingsStore: acceptTerms called with date:', date);
        set({
          termsAccepted: {
            termsAccepted: true,
            date,
          },
        });
      },

      getTermsAccepted: () => {
        const termsAccepted = get().termsAccepted;
        console.log('SettingsStore: getTermsAccepted called, returning:', termsAccepted);
        return termsAccepted;
      },

      isTermsAccepted: () => {
        const termsAccepted = get().termsAccepted;
        const isAccepted = termsAccepted?.termsAccepted === true;
        console.log('SettingsStore: isTermsAccepted called, returning:', isAccepted);
        return isAccepted;
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
          passcode: '',
          experimental: false,
          termsAccepted: null,
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
            passcode: '',
            experimental: false,
            termsAccepted: null,
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
        experimental: state.experimental,
        termsAccepted: state.termsAccepted,
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

// Helper function to check if a theme is a background image theme
export const isBackgroundImageTheme = (theme: string): boolean => {
  return BACKGROUND_IMAGE_THEMES.includes(theme);
};

// Helper function to get the background image for a theme
export const getBackgroundImageForTheme = (theme: string): string | null => {
  return isBackgroundImageTheme(theme) ? theme : null;
};
