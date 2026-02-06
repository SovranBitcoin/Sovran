import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isBackgroundImageTheme } from 'config/backgroundImageThemes';

interface TermsAccepted {
  termsAccepted: boolean;
  date: string;
}

export type DisplayCurrency = 'usd' | 'eur' | 'gbp';

export type MiddlemanTrustMode = 'trusted_only' | 'allow_untrusted';

export interface MiddlemanRoutingSettings {
  /** Maximum number of intermediary mints in a route (1 = A→via→B, 2 = A→via1→via2→B). */
  maxHops: number;
  /** Maximum total fee (in sats) allowed across all hops of an intermediary route. */
  maxFee: number;
  /** Minimum success rate (0–1) required for each edge in the route (e.g. 0.9 = 90%). */
  minSuccessRate: number;
  /** When true, the most recent swap on each edge must have been OK. */
  requireLastOk: boolean;
  /**
   * Controls which mints can act as intermediaries:
   * - `'trusted_only'` (default) — only mints the user already trusts.
   * - `'allow_untrusted'` — any mint from auditor data; untrusted mints are
   *   temporarily trusted for the swap and untrusted afterward.
   */
  trustMode: MiddlemanTrustMode;
}

interface SettingsState {
  // Core settings
  theme: string;
  language: string;
  displayBtc: number;
  displayCurrency: DisplayCurrency;
  passcode: string;
  experimental: boolean;
  termsAccepted: TermsAccepted | null;
  quickAccessP2PK: boolean;
  sendLocationEnabled: boolean;

  // Rebalancing settings
  /** Minimum transfer amount in sats to include in a rebalance plan. */
  minTransferThreshold: number;

  // Middleman routing settings
  middlemanRouting: MiddlemanRoutingSettings;
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

  // Send location stamping
  setSendLocationEnabled: (enabled: boolean) => void;
  getSendLocationEnabled: () => boolean;

  // Rebalancing
  setMinTransferThreshold: (sats: number) => void;
  getMinTransferThreshold: () => number;

  // Middleman routing
  setMiddlemanRouting: (settings: Partial<MiddlemanRoutingSettings>) => void;
  getMiddlemanRouting: () => MiddlemanRoutingSettings;

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
      sendLocationEnabled: false,
      minTransferThreshold: 5,
      middlemanRouting: {
        maxHops: 1,
        maxFee: 5,
        minSuccessRate: 0.9,
        requireLastOk: true,
        trustMode: 'trusted_only',
      },

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

      // Send location stamping
      setSendLocationEnabled: (enabled: boolean) => {
        set({ sendLocationEnabled: enabled });
      },

      getSendLocationEnabled: () => {
        return get().sendLocationEnabled;
      },

      // Rebalancing
      setMinTransferThreshold: (sats: number) => {
        set({ minTransferThreshold: sats });
      },

      getMinTransferThreshold: () => {
        return get().minTransferThreshold;
      },

      // Middleman routing
      setMiddlemanRouting: (settings) => {
        set((state) => ({
          middlemanRouting: { ...state.middlemanRouting, ...settings },
        }));
      },

      getMiddlemanRouting: () => {
        return get().middlemanRouting;
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
          sendLocationEnabled: false,
          minTransferThreshold: 5,
          middlemanRouting: {
            maxHops: 1,
            maxFee: 5,
            minSuccessRate: 0.9,
            requireLastOk: true,
            trustMode: 'trusted_only',
          },
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
            sendLocationEnabled: false,
            minTransferThreshold: 5,
            middlemanRouting: {
              maxHops: 1,
              maxFee: 5,
              minSuccessRate: 0.9,
              requireLastOk: true,
              trustMode: 'trusted_only',
            },
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
        sendLocationEnabled: state.sendLocationEnabled,
        minTransferThreshold: state.minTransferThreshold,
        middlemanRouting: state.middlemanRouting,
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
export { isBackgroundImageTheme };
