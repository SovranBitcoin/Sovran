import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isBackgroundImageTheme } from 'config/backgroundImageThemes';
import { log, storeLog } from '@/shared/lib/logger';

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
  theme: string;
  language: string;
  displayBtc: number;
  displayCurrency: DisplayCurrency;
  passcode: string;
  experimental: boolean;
  mockMode: boolean;
  mockOffline: boolean;
  mockFailSend: boolean;
  mockFailMelt: boolean;
  mockFailPaymentRequest: boolean;
  termsAccepted: TermsAccepted | null;
  hasSeenOnboarding: boolean;
  quickAccessP2PK: boolean;
  regenerateP2PKOnReceive: boolean;
  sendLocationEnabled: boolean;
  /** Minimum transfer amount in sats to include in a rebalance plan. */
  minTransferThreshold: number;
  middlemanRouting: MiddlemanRoutingSettings;
}

const DEFAULT_MIDDLEMAN_ROUTING: MiddlemanRoutingSettings = {
  maxHops: 2,
  maxFee: 5,
  minSuccessRate: 0.9,
  requireLastOk: true,
  trustMode: 'trusted_only',
};

/** Default settings used for initialization and reset. Passcode excluded (never persisted). */
const DEFAULT_SETTINGS: Omit<SettingsState, 'passcode'> = {
  theme: 'dark',
  language: 'en',
  displayBtc: 3,
  displayCurrency: 'usd',
  experimental: false,
  mockMode: false,
  mockOffline: false,
  mockFailSend: false,
  mockFailMelt: false,
  mockFailPaymentRequest: false,
  termsAccepted: null,
  hasSeenOnboarding: false,
  quickAccessP2PK: false,
  regenerateP2PKOnReceive: true,
  sendLocationEnabled: false,
  minTransferThreshold: 5,
  middlemanRouting: DEFAULT_MIDDLEMAN_ROUTING,
};

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

  // Mock mode (demo data)
  setMockMode: (enabled: boolean) => void;
  getMockMode: () => boolean;
  setMockOffline: (enabled: boolean) => void;
  getMockOffline: () => boolean;
  setMockFailSend: (enabled: boolean) => void;
  getMockFailSend: () => boolean;
  setMockFailMelt: (enabled: boolean) => void;
  getMockFailMelt: () => boolean;
  setMockFailPaymentRequest: (enabled: boolean) => void;
  getMockFailPaymentRequest: () => boolean;

  // Terms acceptance
  acceptTerms: (date: string) => void;
  getTermsAccepted: () => TermsAccepted | null;
  isTermsAccepted: () => boolean;

  // Onboarding
  completeOnboarding: () => void;

  // P2PK quick access
  setQuickAccessP2PK: (enabled: boolean) => void;
  getQuickAccessP2PK: () => boolean;

  // P2PK key regeneration on receive
  setRegenerateP2PKOnReceive: (enabled: boolean) => void;
  getRegenerateP2PKOnReceive: () => boolean;

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
      ...DEFAULT_SETTINGS,
      passcode: '',

      // Theme
      setTheme: (theme: string) => {
        storeLog.info('store.settings.set_theme', { theme });
        set({ theme });
      },
      getTheme: () => get().theme,

      // Language
      setLanguage: (language: string) => {
        storeLog.info('store.settings.set_language', { language });
        set({ language });
      },
      getLanguage: () => get().language,

      // Display
      setDisplayBtc: (display: number) => {
        storeLog.info('store.settings.set_display_btc', { display });
        set({ displayBtc: display });
      },
      getDisplayBtc: () => get().displayBtc,
      setDisplayCurrency: (currency: DisplayCurrency) => {
        storeLog.info('store.settings.set_display_currency', { currency });
        set({ displayCurrency: currency });
      },
      getDisplayCurrency: () => get().displayCurrency,

      // Passcode (never persisted)
      setPasscode: (passcode: string) => {
        storeLog.info('store.settings.set_passcode');
        set({ passcode });
      },
      getPasscode: () => get().passcode,
      clearPasscode: () => {
        storeLog.info('store.settings.clear_passcode');
        set({ passcode: '' });
      },

      // Experimental
      setExperimental: (experimental: boolean) => {
        storeLog.info('store.settings.set_experimental', { experimental });
        set({ experimental });
      },
      getExperimental: () => get().experimental,

      // Mock mode — lazy-import to avoid circular dependency at module load time
      setMockMode: (enabled: boolean) => {
        storeLog.info('store.settings.set_mock_mode', { enabled });
        const { useMockDataStore } = require('../runtime/mockDataStore') as {
          useMockDataStore: { getState: () => { activate: () => void; deactivate: () => void } };
        };
        if (enabled) {
          useMockDataStore.getState().activate();
        } else {
          useMockDataStore.getState().deactivate();
        }
        set({ mockMode: enabled });
      },
      getMockMode: () => get().mockMode,
      setMockOffline: (enabled: boolean) => {
        storeLog.info('store.settings.set_mock_offline', { enabled });
        set({ mockOffline: enabled });
      },
      getMockOffline: () => get().mockOffline,
      setMockFailSend: (enabled: boolean) => {
        storeLog.info('store.settings.set_mock_fail_send', { enabled });
        set({ mockFailSend: enabled });
      },
      getMockFailSend: () => get().mockFailSend,
      setMockFailMelt: (enabled: boolean) => {
        storeLog.info('store.settings.set_mock_fail_melt', { enabled });
        set({ mockFailMelt: enabled });
      },
      getMockFailMelt: () => get().mockFailMelt,
      setMockFailPaymentRequest: (enabled: boolean) => {
        storeLog.info('store.settings.set_mock_fail_payment_request', { enabled });
        set({ mockFailPaymentRequest: enabled });
      },
      getMockFailPaymentRequest: () => get().mockFailPaymentRequest,

      // Terms
      acceptTerms: (date: string) => {
        storeLog.info('store.settings.accept_terms', { date });
        set({ termsAccepted: { termsAccepted: true, date } });
      },
      getTermsAccepted: () => get().termsAccepted,
      isTermsAccepted: () => get().termsAccepted?.termsAccepted === true,

      // Onboarding
      completeOnboarding: () => {
        storeLog.info('store.settings.complete_onboarding');
        set({ hasSeenOnboarding: true });
      },

      // P2PK
      setQuickAccessP2PK: (enabled: boolean) => {
        storeLog.info('store.settings.set_quick_access_p2pk', { enabled });
        set({ quickAccessP2PK: enabled });
      },
      getQuickAccessP2PK: () => get().quickAccessP2PK,
      setRegenerateP2PKOnReceive: (enabled: boolean) => {
        storeLog.info('store.settings.set_regenerate_p2pk', { enabled });
        set({ regenerateP2PKOnReceive: enabled });
      },
      getRegenerateP2PKOnReceive: () => get().regenerateP2PKOnReceive,

      // Location stamping
      setSendLocationEnabled: (enabled: boolean) => {
        storeLog.info('store.settings.set_send_location', { enabled });
        set({ sendLocationEnabled: enabled });
      },
      getSendLocationEnabled: () => get().sendLocationEnabled,

      // Rebalancing
      setMinTransferThreshold: (sats: number) => {
        storeLog.info('store.settings.set_min_transfer_threshold', { sats });
        set({ minTransferThreshold: sats });
      },
      getMinTransferThreshold: () => get().minTransferThreshold,

      // Middleman routing
      setMiddlemanRouting: (settings) => {
        storeLog.info('store.settings.set_middleman_routing', { settings });
        set((state) => ({
          middlemanRouting: { ...state.middlemanRouting, ...settings },
        }));
      },
      getMiddlemanRouting: () => get().middlemanRouting,

      // Utility
      getAllSettings: () => get(),

      resetSettings: () => {
        storeLog.info('store.settings.reset');
        set({ ...DEFAULT_SETTINGS, passcode: '' });
      },

      clearAllData: async () => {
        try {
          await AsyncStorage.removeItem('settings-store');
          set({ ...DEFAULT_SETTINGS, passcode: '' });
        } catch (error) {
          log.error('store.settings.clear_failed', { error });
          throw error;
        }
      },
    }),
    {
      name: 'settings-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        displayBtc: state.displayBtc,
        displayCurrency: state.displayCurrency,
        experimental: state.experimental,
        mockMode: state.mockMode,
        mockOffline: state.mockOffline,
        mockFailSend: state.mockFailSend,
        mockFailMelt: state.mockFailMelt,
        mockFailPaymentRequest: state.mockFailPaymentRequest,
        termsAccepted: state.termsAccepted,
        hasSeenOnboarding: state.hasSeenOnboarding,
        quickAccessP2PK: state.quickAccessP2PK,
        regenerateP2PKOnReceive: state.regenerateP2PKOnReceive,
        sendLocationEnabled: state.sendLocationEnabled,
        minTransferThreshold: state.minTransferThreshold,
        middlemanRouting: state.middlemanRouting,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          log.warn('store.settings.rehydrate_failed', { error });
          return;
        }
        if (state?.mockMode) {
          const { useMockDataStore } = require('../runtime/mockDataStore') as {
            useMockDataStore: { getState: () => { activate: () => void } };
          };
          useMockDataStore.getState().activate();
        }
      },
    }
  )
);

// Re-export background image helpers from the config file
export { isBackgroundImageTheme };
