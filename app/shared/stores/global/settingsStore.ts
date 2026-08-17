import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { storeLog, applyFileLogging } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

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

// ⛔ DATA-LOSS FOOTGUN — read before adding or tightening any field below.
//
// On rehydrate, `createMergeWithSchema` runs ONE `safeParse` over this whole
// blob and, if ANY single field fails, throws away the ENTIRE persisted
// settings object — silently resetting `termsAccepted` (so the terms gate
// shows on every launch), `hasSeenOnboarding`, and every other setting. A
// renamed `z.enum` value on a device that persisted the old name is exactly
// this trap: the Balance-split rename `hero-minimal` → `list` wiped settings
// this way (symptom in logs: `store.settings.merge_rejected`).
//
// Defence: every constrained field carries `.default(D).catch(D)` —
// `.default` absorbs a missing field, `.catch` absorbs a present-but-invalid
// value so that field degrades to its default INSTEAD of failing the parse.
// Keep this on every new field. Renaming/removing an enum value is still a
// breaking change to durable data — `.catch` makes it degrade gracefully
// instead of wiping. If an old value must be remapped to a SPECIFIC new one,
// bump `version` + add a `migrate`. See skill `sovran-data` + AGENTS.md.
const PersistedTermsAccepted = z
  .object({
    termsAccepted: z.boolean(),
    date: z.string().max(64),
  })
  .nullable();

const PersistedMiddlemanRouting = z.looseObject({
  // `.catch` keeps a stale/out-of-range value from failing the whole-blob parse
  // (which would discard the entire settings store, incl. terms acceptance).
  maxHops: z.number().int().min(1).max(8).default(2).catch(2),
  maxFee: z.number().int().nonnegative().default(5).catch(5),
  minSuccessRate: z.number().min(0).max(1).default(0.9).catch(0.9),
  requireLastOk: z.boolean().default(true).catch(true),
  trustMode: z
    .enum(['trusted_only', 'allow_untrusted'])
    .default('trusted_only')
    .catch('trusted_only'),
});

const DEFAULT_MIDDLEMAN_ROUTING_PERSISTED = {
  maxHops: 2,
  maxFee: 5,
  minSuccessRate: 0.9,
  requireLastOk: true,
  trustMode: 'trusted_only',
} as const;

const PersistedSettings = z.object({
  language: z.string().max(16).default('en').catch('en'),
  displayBtc: z.number().int().min(0).max(8).default(3).catch(3),
  displayCurrency: z.enum(['usd', 'eur', 'gbp']).default('usd').catch('usd'),
  experimental: z.boolean().default(false).catch(false),
  mockMode: z.boolean().default(false).catch(false),
  mockOffline: z.boolean().default(false).catch(false),
  mockFailSend: z.boolean().default(false).catch(false),
  mockFailMelt: z.boolean().default(false).catch(false),
  mockFailPaymentRequest: z.boolean().default(false).catch(false),
  whitenoiseEnabled: z.boolean().default(false).catch(false),
  mockNoGlass: z.boolean().default(false).catch(false),
  // `.catch(null)` so a malformed terms record only resets terms (re-prompt),
  // never takes the rest of the store (real settings) down with it.
  termsAccepted: PersistedTermsAccepted.default(null).catch(null),
  hasSeenOnboarding: z.boolean().default(false).catch(false),
  quickAccessP2PK: z.boolean().default(false).catch(false),
  regenerateP2PKOnReceive: z.boolean().default(true).catch(true),
  sendLocationEnabled: z.boolean().default(false).catch(false),
  fileLoggingEnabled: z.boolean().default(false).catch(false),
  naggTierEnabled: z.boolean().default(true).catch(true),
  primalTierEnabled: z.boolean().default(true).catch(true),
  relayTierEnabled: z.boolean().default(true).catch(true),
  minTransferThreshold: z.number().int().nonnegative().default(5).catch(5),
  middlemanRouting: PersistedMiddlemanRouting.default(DEFAULT_MIDDLEMAN_ROUTING_PERSISTED).catch(
    DEFAULT_MIDDLEMAN_ROUTING_PERSISTED
  ),
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
  minTransferThreshold: 5,
  middlemanRouting: DEFAULT_MIDDLEMAN_ROUTING,
};

interface SettingsActions {
  // Display settings
  setDisplayBtc: (display: number) => void;
  getDisplayBtc: () => number;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
  getDisplayCurrency: () => DisplayCurrency;

  // Experimental features
  setExperimental: (experimental: boolean) => void;

  // Mock mode (demo data)
  setMockMode: (enabled: boolean) => void;
  setMockOffline: (enabled: boolean) => void;
  setMockFailSend: (enabled: boolean) => void;
  setMockFailMelt: (enabled: boolean) => void;
  setMockFailPaymentRequest: (enabled: boolean) => void;
  setWhitenoiseEnabled: (enabled: boolean) => void;
  setMockNoGlass: (enabled: boolean) => void;

  // Terms acceptance
  acceptTerms: (date: string) => void;
  isTermsAccepted: () => boolean;

  // Onboarding
  completeOnboarding: () => void;

  // P2PK key regeneration on receive
  setRegenerateP2PKOnReceive: (enabled: boolean) => void;

  // Send location stamping
  setSendLocationEnabled: (enabled: boolean) => void;

  // On-device file logging (dev diagnostics)
  setFileLoggingEnabled: (enabled: boolean) => void;

  // Nostr data-layer per-tier enablement (dev)
  setNaggTierEnabled: (enabled: boolean) => void;
  setPrimalTierEnabled: (enabled: boolean) => void;
  setRelayTierEnabled: (enabled: boolean) => void;

  // Rebalancing
  setMinTransferThreshold: (sats: number) => void;

  // Middleman routing
  setMiddlemanRouting: (settings: Partial<MiddlemanRoutingSettings>) => void;
}

type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        ...DEFAULT_SETTINGS,

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
        setMockOffline: (enabled: boolean) => {
          storeLog.info('store.settings.set_mock_offline', { enabled });
          set({ mockOffline: enabled });
        },
        setMockFailSend: (enabled: boolean) => {
          storeLog.info('store.settings.set_mock_fail_send', { enabled });
          set({ mockFailSend: enabled });
        },
        setMockFailMelt: (enabled: boolean) => {
          storeLog.info('store.settings.set_mock_fail_melt', { enabled });
          set({ mockFailMelt: enabled });
        },
        setMockFailPaymentRequest: (enabled: boolean) => {
          storeLog.info('store.settings.set_mock_fail_payment_request', { enabled });
          set({ mockFailPaymentRequest: enabled });
        },
        setWhitenoiseEnabled: (enabled: boolean) => {
          storeLog.info('store.settings.set_whitenoise_enabled', { enabled });
          set({ whitenoiseEnabled: enabled });
        },
        setMockNoGlass: (enabled: boolean) => {
          storeLog.info('store.settings.set_mock_no_glass', { enabled });
          set({ mockNoGlass: enabled });
        },

        // Terms
        acceptTerms: (date: string) => {
          storeLog.info('store.settings.accept_terms', { date });
          set({ termsAccepted: { termsAccepted: true, date } });
        },
        isTermsAccepted: () => get().termsAccepted?.termsAccepted === true,

        // Onboarding
        completeOnboarding: () => {
          storeLog.info('store.settings.complete_onboarding');
          set({ hasSeenOnboarding: true });
        },
        setRegenerateP2PKOnReceive: (enabled: boolean) => {
          storeLog.info('store.settings.set_regenerate_p2pk', { enabled });
          set({ regenerateP2PKOnReceive: enabled });
        },

        // Location stamping
        setSendLocationEnabled: (enabled: boolean) => {
          storeLog.info('store.settings.set_send_location', { enabled });
          set({ sendLocationEnabled: enabled });
        },

        // File logging — drive the logger's file transport alongside the
        // persisted flag so toggling takes effect immediately.
        setFileLoggingEnabled: (enabled: boolean) => {
          storeLog.info('store.settings.set_file_logging', { enabled });
          set({ fileLoggingEnabled: enabled });
          applyFileLogging(enabled);
        },

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

        // Rebalancing
        setMinTransferThreshold: (sats: number) => {
          storeLog.info('store.settings.set_min_transfer_threshold', { sats });
          set({ minTransferThreshold: sats });
        },

        // Middleman routing
        setMiddlemanRouting: (settings) => {
          storeLog.info('store.settings.set_middleman_routing', { settings });
          set((state) => ({
            middlemanRouting: { ...state.middlemanRouting, ...settings },
          }));
        },
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
        version: 4,
        migrate: (state) => {
          const persisted = (state ?? {}) as z.infer<typeof PersistedSettings>;
          return {
            ...persisted,
            // v3 -> v4: one-time developer reset (mirrors the wallpaper/theme
            // reset). Anyone who wandered into dev mode via the triple-tap —
            // or flipped any developer toggle — lands back on stock behavior;
            // the mock-flag resets below are subsumed but kept for old blobs.
            experimental: false,
            whitenoiseEnabled: false,
            fileLoggingEnabled: false,
            naggTierEnabled: true,
            primalTierEnabled: true,
            relayTierEnabled: true,
            mockMode: false,
            mockOffline: false,
            mockFailSend: false,
            mockFailMelt: false,
            mockFailPaymentRequest: false,
            mockNoGlass: false,
            // `avatarFallbackVariant` (the removed avatar-style picker enum) is
            // deliberately absent here: old blobs of any version still carry
            // the key, the plain `z.object` in `merge` strips unknown keys, and
            // the first persist write drops it from disk (partialize no longer
            // emits it) — same pattern as the removed `balanceSplitVariant`;
            // see settingsStorePersistResilience.test.ts. Do NOT re-add a field
            // or bump `version` for it: a bump would re-run the un-guarded dev
            // reset above on v4 blobs.
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
