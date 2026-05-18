// ---------------------------------------------------------------------------
// CocoPaymentUXProvider — React context + hooks for the payment flow machine
//
// Creates a singleton PaymentMachine, holds live refs for wallet context,
// unit, and handlers, and exposes hooks to bind and consume the machine.
//
// The wallet (e.g. Sovran) provides flat props:
//   - handlers: factory that receives the machine and returns StepHandlerMap
//   - operations / notifications / persistence callbacks
//   - actions: post-terminal screen action handlers for useScreenActions
// ---------------------------------------------------------------------------

import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';

import { useLatestRef } from './useLatestRef';
import { registerLocale } from '../formatting/locales';
import { errField, logger } from '../logger';
import { createPaymentMachine } from '../machine/createMachine';
import type {
  MachineOperations,
  NfcIOAdapter,
  NotificationHandlerMap,
  PaymentMachine,
  ScanSources,
  StepHandlerMap,
  URDecoderLike,
} from '../machine/types';
import type { ScreenActionHandlerMap, ScreenType } from '../screen-actions/types';
import type { NavigationCallbacks } from '../screen-actions/defaultHandlers';
import type { Detectors, WalletContext } from '../types';
import type { CocoPaymentUXInstance } from '../core/createCocoPaymentUX';

/**
 * Defence-in-depth cap on deep-link host length. The OS typically caps intent
 * URL length around a few KB; this keeps a malicious app from inducing
 * unbounded scan-pipeline work via a prepared intent.
 */
const DEEP_LINK_HOST_MAX_LENGTH = 16384;

// ---------------------------------------------------------------------------
// ScreenActionsBridge — optional wallet hooks for useScreenActions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DeepLinkConfig — automatic deep link processing
// ---------------------------------------------------------------------------

export interface DeepLinkConfig {
  /** Current deep link URL (reactive). E.g. from expo-linking's useURL(). */
  url: string | null | undefined;
  /** Additional URI schemes to accept beyond 'cashu'. */
  customSchemes?: string[];
  /** Hostnames to ignore (e.g. router-handled paths like 'camera'). */
  ignoredHosts?: string[];
  /** Called when deep link processing fails. */
  onError?: (error: Error) => void;
}

export interface ScreenActionsBridge {
  /** Merged into action context after `paymentMachine` (from context). */
  getExtraContext?: () => Record<string, unknown>;
  /**
   * Subscribe to entry updates for this screen type (e.g. history + melt ops).
   * Return unsubscribe.
   */
  onEntryUpdate?: (
    screenType: ScreenType,
    callback: (entry: Record<string, unknown>) => void
  ) => () => void;
  shouldApplyEntryUpdate?: (
    currentEntry: Record<string, unknown> | null,
    updatedEntry: Record<string, unknown>
  ) => boolean;
  mergeEntryUpdate?: (
    currentEntry: Record<string, unknown> | null,
    updatedEntry: Record<string, unknown>
  ) => Record<string, unknown>;
  /** When omitted, raw manager entry is returned. */
  decorateEntry?: (
    entry: Record<string, unknown> | null,
    ctx: { language: string }
  ) => Record<string, unknown> | null;
  getLocale?: () => string;
  /**
   * When set, useScreenActions subscribes so `getSourceLabel` can react to
   * store updates (e.g. scan history) without the package importing Zustand.
   */
  subscribeGlobalScreenActions?: (listener: () => void) => () => void;
  /** Scan / NFC provenance label for the current entry. */
  getSourceLabel?: (entry: Record<string, unknown> | null) => string | null;
}

// ---------------------------------------------------------------------------
// Refs passed to the handler factory
// ---------------------------------------------------------------------------

/**
 * Live refs exposed to the handler factory so handlers can read
 * values that change after creation (e.g. option dismiss callback).
 */
interface PaymentFlowRefs {
  getOptionDismiss: () => (() => void) | undefined;
}

// ---------------------------------------------------------------------------
// Provider props — grouped by concern (see README)
// ---------------------------------------------------------------------------

/**
 * Wallet engine wiring. Supplies the engine instance produced by
 * `createCocoPaymentUX()` along with optional overrides for the operations
 * map and any custom protocol detectors.
 *
 * The instance is the recommended path for non-trivial consumers — it
 * carries the operations map, wallet-context tracker, and (via
 * `instance.config`) the runtime getters and platform adapters too.
 * `operations` and `detectors` here override the corresponding instance
 * fields when both are present.
 */
interface EngineConfig {
  instance?: CocoPaymentUXInstance;
  operations?: MachineOperations;
  detectors?: Detectors;
}

/**
 * Behavior callbacks — error/validation notifications, post-terminal
 * screen-action handlers, and the optional bridge for `useScreenActions`
 * extras (history subscriptions, decoration, scan provenance).
 */
interface CallbackConfig {
  notifications?: NotificationHandlerMap;
  actions?: ScreenActionHandlerMap;
  screenActionsBridge?: ScreenActionsBridge;
}

/**
 * Runtime values read on each machine event (current offline state, BTC
 * price, display currency, locale) plus localization translation
 * dictionaries.
 *
 * The getters are read through `useLatestRef`, so updating any of them
 * does not trigger a render — the latest value is observed at the next
 * machine event. Each getter falls back to the matching field on
 * `engine.instance.config` when omitted; `getLocale` defaults to `'en'`.
 *
 * `translations` is registered against the module-level locale map on
 * mount and on every change; missing keys fall back to English.
 */
interface RuntimeConfig {
  getOffline?: () => boolean;
  getBtcPrice?: () => number;
  getDisplayCurrency?: () => { code: string; symbol: string } | null;
  getLocale?: () => string;
  translations?: Record<string, Record<string, string>>;
}

/**
 * Platform integrations — clipboard write, share sheet, NFC adapter,
 * URDecoder factory, scan sources, deep-link config, and navigation
 * callbacks. Each may also be supplied via
 * `engine.instance.config.platform`; the top-level value wins when both
 * are set.
 */
interface PlatformConfig {
  writeClipboard?: (text: string) => Promise<void>;
  shareContent?: (content: { message: string; url?: string }) => Promise<void>;
  nfcAdapter?: NfcIOAdapter;
  createURDecoder?: () => URDecoderLike;
  scanSources?: ScanSources;
  deepLinks?: DeepLinkConfig;
  navigation?: NavigationCallbacks;
}

interface CocoPaymentUXProviderProps {
  children: React.ReactNode;
  /**
   * Required step-handler factory. Called once after the machine is
   * created — returns the `StepHandlerMap` it will use.
   */
  handlers: (machine: PaymentMachine, refs: PaymentFlowRefs) => StepHandlerMap;
  /** Engine wiring (instance + operations override + custom detectors). */
  engine?: EngineConfig;
  /** Behavior callbacks (notifications, screen actions, screen-actions bridge). */
  callbacks?: CallbackConfig;
  /** Runtime values + locale (getters + translations). */
  runtime?: RuntimeConfig;
  /** Platform integrations (clipboard, share, NFC, scan, deep-links, navigation). */
  platform?: PlatformConfig;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface CocoPaymentUXContextValue {
  machine: PaymentMachine;
  walletContextRef: React.MutableRefObject<WalletContext | null>;
  unitRef: React.MutableRefObject<string>;
  optionDismissRef: React.MutableRefObject<(() => void) | undefined>;
  screenActionHandlers: ScreenActionHandlerMap;
  screenActionsBridge: ScreenActionsBridge | undefined;
  getLocaleRef: React.MutableRefObject<(() => string) | undefined>;
  getOfflineRef: React.MutableRefObject<(() => boolean) | undefined>;
  getBtcPriceRef: React.MutableRefObject<(() => number) | undefined>;
  getDisplayCurrencyRef: React.MutableRefObject<
    (() => { code: string; symbol: string } | null) | undefined
  >;
  notificationsRef: React.MutableRefObject<NotificationHandlerMap | undefined>;
  operationsRef: React.MutableRefObject<Partial<MachineOperations> | undefined>;
  navigationRef: React.MutableRefObject<NavigationCallbacks | undefined>;
  writeClipboardRef: React.MutableRefObject<((text: string) => Promise<void>) | undefined>;
  shareContentRef: React.MutableRefObject<
    ((content: { message: string; url?: string }) => Promise<void>) | undefined
  >;
}

const CocoPaymentUXContext = createContext<CocoPaymentUXContextValue | null>(null);

const EMPTY_SCREEN_ACTIONS = {} as ScreenActionHandlerMap;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function CocoPaymentUXProvider({
  children,
  handlers: handlersFactory,
  engine,
  callbacks,
  runtime,
  platform,
}: CocoPaymentUXProviderProps) {
  // Pull individual fields out of each group, then fall back to the engine
  // instance's config (`createCocoPaymentUX(...).config`) where the package
  // already structures the same values. The top-level prop wins when both
  // are set.
  const { instance, operations: operationsProp, detectors } = engine ?? {};
  const { notifications, actions, screenActionsBridge } = callbacks ?? {};
  const {
    getOffline: getOfflineProp,
    getBtcPrice: getBtcPriceProp,
    getDisplayCurrency: getDisplayCurrencyProp,
    getLocale: getLocaleProp,
    translations,
  } = runtime ?? {};
  const {
    writeClipboard: writeClipboardProp,
    shareContent: shareContentProp,
    nfcAdapter: nfcAdapterProp,
    createURDecoder: createURDecoderProp,
    scanSources: scanSourcesProp,
    deepLinks,
    navigation,
  } = platform ?? {};

  const ic = instance?.config;
  const getLocale = getLocaleProp ?? ic?.getLocale;
  const getOffline = getOfflineProp ?? ic?.getOffline;
  const getBtcPrice = getBtcPriceProp ?? ic?.getBtcPrice;
  const getDisplayCurrency = getDisplayCurrencyProp ?? ic?.getDisplayCurrency;
  const writeClipboard = writeClipboardProp ?? ic?.platform?.clipboard?.write;
  const shareContent = shareContentProp ?? ic?.platform?.share;
  const scanSources = scanSourcesProp ?? ic?.platform?.scanSources;
  const nfcAdapter = nfcAdapterProp ?? ic?.platform?.nfc;
  const createURDecoder = createURDecoderProp ?? ic?.platform?.createURDecoder;

  const getLocaleRef = useLatestRef(getLocale);
  const notificationsRef = useLatestRef(notifications);
  const operations = operationsProp ?? instance?.operations;
  const operationsRef = useLatestRef<Partial<MachineOperations> | undefined>(operations);
  const navigationRef = useLatestRef<NavigationCallbacks | undefined>(navigation);
  const writeClipboardRef = useLatestRef(writeClipboard);
  const shareContentRef = useLatestRef(shareContent);

  const getOfflineRef = useLatestRef(getOffline);
  const getBtcPriceRef = useLatestRef(getBtcPrice);
  const getDisplayCurrencyRef = useLatestRef(getDisplayCurrency);

  const walletContextRef = useRef<WalletContext | null>(null);
  const unitRef = useRef('sat');
  const optionDismissRef = useRef<(() => void) | undefined>(undefined);
  const handlersRef = useRef<StepHandlerMap>({});
  const machineRef = useRef<PaymentMachine | null>(null);

  // Translations register on a module-level locale map. Run as an effect so
  // the side effect happens after commit (StrictMode double-invoke of render
  // would otherwise duplicate the work and re-allocate Object.entries each
  // render).
  useEffect(() => {
    if (!translations) return;
    for (const [lang, dict] of Object.entries(translations)) {
      registerLocale(lang, dict);
    }
  }, [translations]);

  if (!machineRef.current) {
    machineRef.current = createPaymentMachine({
      handlers: new Proxy(
        {},
        {
          get: (_target, key: string) => (handlersRef.current as Record<string, unknown>)[key],
        }
      ) as StepHandlerMap,
      detectors,
      getContext: instance
        ? () => instance.tracker.getContext()
        : () => {
            if (!walletContextRef.current) {
              throw new Error('CocoPaymentUXProvider has no wallet context bound yet.');
            }
            return walletContextRef.current;
          },
      getUnit: () => unitRef.current,
      getOffline: () => getOfflineRef.current?.() ?? false,
      getLocale: () => getLocaleRef.current?.() ?? 'en',
      operations: operations as MachineOperations | undefined,
      notifications,
      createURDecoder,
      scanSources,
      nfcAdapter,
    });

    handlersRef.current = handlersFactory(machineRef.current, {
      getOptionDismiss: () => optionDismissRef.current,
    });
  }

  // Re-bind handlers when the factory identity changes. Runs in
  // useLayoutEffect so the next event handled by the machine sees the
  // updated handler map without a render gap.
  useLayoutEffect(() => {
    if (!machineRef.current) return;
    handlersRef.current = handlersFactory(machineRef.current, {
      getOptionDismiss: () => optionDismissRef.current,
    });
  }, [handlersFactory]);

  // Deep link processing
  useEffect(() => {
    const url = deepLinks?.url;
    if (!url || !machineRef.current?.scan) return;

    // Extract scheme and host from scheme://host or scheme:host
    const match = url.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*):(?:\/\/)?([^/?#]+)/);
    if (!match) return;

    const scheme = match[1].toLowerCase();
    const host = match[2];

    // URI schemes are case-insensitive (RFC 3986 §3.1) and we already
    // lowercased the parsed scheme — so the lookup set must be lowercase
    // too. A wallet passing `customSchemes: ['Cashu']` would otherwise
    // never match.
    const accepted = new Set([
      'cashu',
      ...(deepLinks.customSchemes ?? []).map((s) => s.toLowerCase()),
    ]);
    if (!accepted.has(scheme)) return;

    const ignored = new Set(deepLinks.ignoredHosts ?? []);
    if (ignored.has(host)) return;

    if (host.length > DEEP_LINK_HOST_MAX_LENGTH) {
      logger.warn('deepLink.host.too_long', { length: host.length });
      deepLinks.onError?.(new Error('DEEP_LINK_TOO_LONG'));
      return;
    }

    machineRef.current.scan(host, { source: 'deeplink' }).catch((err) => {
      logger.warn('deepLink.scan.failed', { host, error: errField(err) });
      deepLinks.onError?.(err instanceof Error ? err : new Error(String(err)));
    });
  }, [deepLinks?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const screenActionHandlers = actions ?? EMPTY_SCREEN_ACTIONS;

  const value = useMemo<CocoPaymentUXContextValue>(
    () => ({
      machine: machineRef.current!,
      walletContextRef,
      unitRef,
      optionDismissRef,
      screenActionHandlers,
      screenActionsBridge,
      getLocaleRef,
      getOfflineRef,
      getBtcPriceRef,
      getDisplayCurrencyRef,
      notificationsRef,
      operationsRef,
      navigationRef,
      writeClipboardRef,
      shareContentRef,
    }),
    [walletContextRef, screenActionHandlers, screenActionsBridge]
  );

  return <CocoPaymentUXContext.Provider value={value}>{children}</CocoPaymentUXContext.Provider>;
}

// ---------------------------------------------------------------------------
// Context accessor
// ---------------------------------------------------------------------------

export function useCocoPaymentUXContext(): CocoPaymentUXContextValue {
  const ctx = useContext(CocoPaymentUXContext);
  if (!ctx) {
    throw new Error('CocoPaymentUXProvider is missing. Wrap the app with CocoPaymentUXProvider.');
  }
  return ctx;
}

function usePaymentFlowContext(): CocoPaymentUXContextValue {
  return useCocoPaymentUXContext();
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

interface UsePaymentFlowMachineConfig {
  walletContext: WalletContext;
  unit?: string;
  onOptionDismiss?: () => void;
}

/**
 * Binds the current screen's wallet context and unit to the shared machine.
 * Returns the stable PaymentMachine instance.
 */
export function usePaymentFlowMachine({
  walletContext,
  unit = 'sat',
  onOptionDismiss,
}: UsePaymentFlowMachineConfig): PaymentMachine {
  const ctx = usePaymentFlowContext();

  // Refs are written in useEffect (not during render) so concurrent renders
  // that get discarded — transition aborted, suspense fallback — don't mutate
  // shared provider state with values that were never committed.
  useEffect(() => {
    ctx.walletContextRef.current = walletContext;
    ctx.unitRef.current = unit;
  }, [ctx, walletContext, unit]);

  useEffect(() => {
    ctx.optionDismissRef.current = onOptionDismiss;
    return () => {
      if (ctx.optionDismissRef.current === onOptionDismiss) {
        ctx.optionDismissRef.current = undefined;
      }
    };
  }, [ctx, onOptionDismiss]);

  return ctx.machine;
}
