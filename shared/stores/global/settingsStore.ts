import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { storeLog, applyFileLogging } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import {
  AVATAR_FALLBACK_VARIANTS,
  DEFAULT_AVATAR_FALLBACK_VARIANT,
  type AvatarFallbackVariant,
} from '@/shared/lib/avatarFallback';

interface TermsAccepted {
  termsAccepted: boolean;
  date: string;
}

export type DisplayCurrency = 'usd' | 'eur' | 'gbp';

type MiddlemanTrustMode = 'trusted_only' | 'allow_untrusted';

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
  language: string;
  displayBtc: number;
  displayCurrency: DisplayCurrency;
  experimental: boolean;
  mockMode: boolean;
  mockOffline: boolean;
  mockFailSend: boolean;
  mockFailMelt: boolean;
  mockFailPaymentRequest: boolean;
  /**
   * Hidden developer toggle for surfacing White Noise / Marmot messaging UI.
   * Defaults off so the experimental transport stays invisible unless enabled
   * from Settings -> Developer.
   */
  whitenoiseEnabled: boolean;
  /**
   * Dev toggle: when true, force `supportsLiquidGlass()` to return false
   * everywhere — the app behaves as if the device doesn't support iOS 26
   * liquid glass. Most surfaces re-render the next time they're visible;
   * a few module-level gates (native tabs, headers) need an app relaunch.
   */
  mockNoGlass: boolean;
  termsAccepted: TermsAccepted | null;
  hasSeenOnboarding: boolean;
  quickAccessP2PK: boolean;
  regenerateP2PKOnReceive: boolean;
  sendLocationEnabled: boolean;
  /**
   * Dev toggle: mirror every structured log into a persistent on-device NDJSON
   * file (Settings → Storage → Export). Lets logs be captured and exported
   * while offline, when the Metro/dev-server console is unreachable. Dev-only;
   * inert in production builds (see `loggerFile.ts`).
   */
  fileLoggingEnabled: boolean;
  /**
   * Dev toggles: per-tier enablement for the resilient Nostr data layer
   * (nagg → Primal cache → raw relays). Each flag, when false, removes that tier
   * from the facade's fallback chain — so a developer can simulate "nagg is
   * down", "Primal is down", or "relays are down" and watch the degradation.
   * Default on. The facade reads these when it's wired into the read paths
   * (see `nostrTierSettings`); until then they're inert.
   */
  naggTierEnabled: boolean;
  primalTierEnabled: boolean;
  relayTierEnabled: boolean;
  avatarFallbackVariant: AvatarFallbackVariant;
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

// Persisted-shape schema (defensive rehydrate validation). All fields are
// optional + carry a default so adding a new field doesn't drop the user's
// existing settings on first launch.
const PersistedTermsAccepted = z
  .object({
    termsAccepted: z.boolean(),
    date: z.string().max(64),
  })
  .nullable();

const PersistedMiddlemanRouting = z.looseObject({
  maxHops: z.number().int().min(1).max(8),
  maxFee: z.number().int().nonnegative(),
  minSuccessRate: z.number().min(0).max(1),
  requireLastOk: z.boolean(),
  trustMode: z.enum(['trusted_only', 'allow_untrusted']),
});

const PersistedSettings = z.object({
  language: z.string().max(16).default('en'),
  displayBtc: z.number().int().min(0).max(8).default(3),
  displayCurrency: z.enum(['usd', 'eur', 'gbp']).default('usd'),
  experimental: z.boolean().default(false),
  mockMode: z.boolean().default(false),
  mockOffline: z.boolean().default(false),
  mockFailSend: z.boolean().default(false),
  mockFailMelt: z.boolean().default(false),
  mockFailPaymentRequest: z.boolean().default(false),
  whitenoiseEnabled: z.boolean().default(false),
  mockNoGlass: z.boolean().default(false),
  termsAccepted: PersistedTermsAccepted.default(null),
  hasSeenOnboarding: z.boolean().default(false),
  quickAccessP2PK: z.boolean().default(false),
  regenerateP2PKOnReceive: z.boolean().default(true),
  sendLocationEnabled: z.boolean().default(false),
  fileLoggingEnabled: z.boolean().default(false),
  naggTierEnabled: z.boolean().default(true),
  primalTierEnabled: z.boolean().default(true),
  relayTierEnabled: z.boolean().default(true),
  avatarFallbackVariant: z.enum(AVATAR_FALLBACK_VARIANTS).default(DEFAULT_AVATAR_FALLBACK_VARIANT),
  minTransferThreshold: z.number().int().nonnegative().default(5),
  middlemanRouting: PersistedMiddlemanRouting.default({
    maxHops: 2,
    maxFee: 5,
    minSuccessRate: 0.9,
    requireLastOk: true,
    trustMode: 'trusted_only',
  }),
});

/** Default settings used for initialization and reset. */
const DEFAULT_SETTINGS: SettingsState = {
  language: 'en',
  displayBtc: 3,
  displayCurrency: 'usd',
  experimental: false,
  mockMode: false,
  mockOffline: false,
  mockFailSend: false,
  mockFailMelt: false,
  mockFailPaymentRequest: false,
  whitenoiseEnabled: false,
  mockNoGlass: false,
  termsAccepted: null,
  hasSeenOnboarding: false,
  quickAccessP2PK: false,
  regenerateP2PKOnReceive: true,
  sendLocationEnabled: false,
  fileLoggingEnabled: false,
  naggTierEnabled: true,
  primalTierEnabled: true,
  relayTierEnabled: true,
  avatarFallbackVariant: DEFAULT_AVATAR_FALLBACK_VARIANT,
  minTransferThreshold: 5,
  middlemanRouting: DEFAULT_MIDDLEMAN_ROUTING,
};

interface SettingsActions {
  // Language management
  setLanguage: (language: string) => void;
  getLanguage: () => string;

  // Display settings
  setDisplayBtc: (display: number) => void;
  getDisplayBtc: () => number;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
  getDisplayCurrency: () => DisplayCurrency;

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
  setWhitenoiseEnabled: (enabled: boolean) => void;
  getWhitenoiseEnabled: () => boolean;
  setMockNoGlass: (enabled: boolean) => void;
  getMockNoGlass: () => boolean;

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

  // On-device file logging (dev diagnostics)
  setFileLoggingEnabled: (enabled: boolean) => void;
  getFileLoggingEnabled: () => boolean;

  // Nostr data-layer per-tier enablement (dev)
  setNaggTierEnabled: (enabled: boolean) => void;
  setPrimalTierEnabled: (enabled: boolean) => void;
  setRelayTierEnabled: (enabled: boolean) => void;

  // Avatar fallback variation
  setAvatarFallbackVariant: (variant: AvatarFallbackVariant) => void;
  getAvatarFallbackVariant: () => AvatarFallbackVariant;

  // Rebalancing
  setMinTransferThreshold: (sats: number) => void;
  getMinTransferThreshold: () => number;

  // Middleman routing
  setMiddlemanRouting: (settings: Partial<MiddlemanRoutingSettings>) => void;
  getMiddlemanRouting: () => MiddlemanRoutingSettings;
}

type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        ...DEFAULT_SETTINGS,

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
        setWhitenoiseEnabled: (enabled: boolean) => {
          storeLog.info('store.settings.set_whitenoise_enabled', { enabled });
          set({ whitenoiseEnabled: enabled });
        },
        getWhitenoiseEnabled: () => get().whitenoiseEnabled,
        setMockNoGlass: (enabled: boolean) => {
          storeLog.info('store.settings.set_mock_no_glass', { enabled });
          set({ mockNoGlass: enabled });
        },
        getMockNoGlass: () => get().mockNoGlass,

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

        // File logging — drive the logger's file transport alongside the
        // persisted flag so toggling takes effect immediately.
        setFileLoggingEnabled: (enabled: boolean) => {
          storeLog.info('store.settings.set_file_logging', { enabled });
          set({ fileLoggingEnabled: enabled });
          applyFileLogging(enabled);
        },
        getFileLoggingEnabled: () => get().fileLoggingEnabled,

        // Nostr data-layer tiers (dev)
        setNaggTierEnabled: (enabled: boolean) => {
          storeLog.info('store.settings.set_nagg_tier_enabled', { enabled });
          set({ naggTierEnabled: enabled });
        },
        setPrimalTierEnabled: (enabled: boolean) => {
          storeLog.info('store.settings.set_primal_tier_enabled', { enabled });
          set({ primalTierEnabled: enabled });
        },
        setRelayTierEnabled: (enabled: boolean) => {
          storeLog.info('store.settings.set_relay_tier_enabled', { enabled });
          set({ relayTierEnabled: enabled });
        },

        // Avatar fallback
        setAvatarFallbackVariant: (variant: AvatarFallbackVariant) => {
          storeLog.info('store.settings.set_avatar_fallback_variant', { variant });
          set({ avatarFallbackVariant: variant });
        },
        getAvatarFallbackVariant: () => get().avatarFallbackVariant,

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
      }),
      persistConfig({
        name: 'settings-store',
        storage: AsyncStorage,
        schema: PersistedSettings,
        // v1 -> v2: force every mock flag off. Mock mode (and its fixture
        // identities Bob/Alice) must never persist into a shipped/updated
        // install — it was leaking through after the toggle was disabled. This
        // guarantees every existing install lands with mock OFF on the next
        // launch, regardless of how it was turned on; afterHydrate then purges
        // any fixture metadata that already leaked into the cache.
        version: 3,
        migrate: (state) => {
          const persisted = (state ?? {}) as z.infer<typeof PersistedSettings>;
          return {
            ...persisted,
            mockMode: false,
            mockOffline: false,
            mockFailSend: false,
            mockFailMelt: false,
            mockFailPaymentRequest: false,
            mockNoGlass: false,
            // v2 -> v3: the avatar fallback default moved from the cute `beam`
            // face to the neutral `flat` person glyph (so dense surfaces stay
            // quiet). Installs still carrying the old default ride the new one;
            // explicit `pixel`/`glass`/`flat` choices are preserved.
            avatarFallbackVariant:
              persisted.avatarFallbackVariant === 'beam' ? 'flat' : persisted.avatarFallbackVariant,
          };
        },
        partialize: (state) => ({
          language: state.language,
          displayBtc: state.displayBtc,
          displayCurrency: state.displayCurrency,
          experimental: state.experimental,
          mockMode: state.mockMode,
          mockOffline: state.mockOffline,
          mockFailSend: state.mockFailSend,
          mockFailMelt: state.mockFailMelt,
          mockFailPaymentRequest: state.mockFailPaymentRequest,
          whitenoiseEnabled: state.whitenoiseEnabled,
          mockNoGlass: state.mockNoGlass,
          termsAccepted: state.termsAccepted,
          hasSeenOnboarding: state.hasSeenOnboarding,
          quickAccessP2PK: state.quickAccessP2PK,
          regenerateP2PKOnReceive: state.regenerateP2PKOnReceive,
          sendLocationEnabled: state.sendLocationEnabled,
          fileLoggingEnabled: state.fileLoggingEnabled,
          avatarFallbackVariant: state.avatarFallbackVariant,
          minTransferThreshold: state.minTransferThreshold,
          middlemanRouting: state.middlemanRouting,
          naggTierEnabled: state.naggTierEnabled,
          primalTierEnabled: state.primalTierEnabled,
          relayTierEnabled: state.relayTierEnabled,
        }),
        afterHydrate: (state, error) => {
          if (error) return;
          // Resume on-device file logging if it was left on (dev-only; no-op in
          // production). Mirrors the persisted toggle into the logger transport.
          applyFileLogging(state?.fileLoggingEnabled ?? false);
          if (state?.mockMode) {
            const { useMockDataStore } = require('../runtime/mockDataStore') as {
              useMockDataStore: { getState: () => { activate: () => void } };
            };
            useMockDataStore.getState().activate();
          } else {
            // Mock is off — scrub any fixture identities that leaked into the
            // persisted Nostr metadata cache in a previous build.
            const { purgeFixtureMetadata } = require('../runtime/mockDataStore') as {
              purgeFixtureMetadata: () => void;
            };
            purgeFixtureMetadata();
          }
        },
      })
    )
  )
);
