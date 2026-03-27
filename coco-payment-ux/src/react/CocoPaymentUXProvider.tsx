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
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import { registerLocale } from '../formatting/locales';
import { createPaymentMachine } from '../machine/createMachine';
import { selectMintContext } from '../machine/selectMintContext';
import type {
  FlowContext,
  MachineOperations,
  NfcIOAdapter,
  NotificationHandlerMap,
  PaymentMachine,
  ScanSources,
  StepHandlerMap,
  URDecoderLike,
} from '../machine/types';
import type { MintResolutionContext } from '../machine/selectMintContext';
import type { ScreenActionHandlerMap, ScreenType } from '../screen-actions/types';
import type { NavigationCallbacks } from '../screen-actions/defaultHandlers';
import type { Detectors, WalletContext } from '../types';

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
export interface PaymentFlowRefs {
  getOptionDismiss: () => (() => void) | undefined;
}

// ---------------------------------------------------------------------------
// Flat provider props (see README)
// ---------------------------------------------------------------------------

export interface CocoPaymentUXProviderProps {
  children: React.ReactNode;
  /**
   * Factory called once after the machine is created. Returns the
   * `StepHandlerMap` for the machine.
   */
  handlers: (machine: PaymentMachine, refs: PaymentFlowRefs) => StepHandlerMap;
  /** Async wallet operations (send, mint quote, build mint list). */
  operations?: MachineOperations;
  /** Error/validation notification handlers. */
  notifications?: NotificationHandlerMap;
  /** Called when the machine wants to persist the user's preferred mint. */
  savePreferredMint?: (mintUrl: string) => void;
  /** Called when changeMint is invoked with scope: 'npc'. Updates NPC mint only. */
  saveNpcMint?: (mintUrl: string) => void | Promise<void>;
  /** Called when the provider mounts. Syncs NPC mint from server (wallet-specific). */
  onNpcMintSync?: () => void | Promise<void>;
  /** Custom protocol detectors. Falls back to built-in detectors. */
  detectors?: Detectors;
  /**
   * Optional external wallet context ref. When provided, the provider
   * uses this ref instead of creating an internal one.
   */
  walletContextRef?: React.MutableRefObject<WalletContext | null>;
  /**
   * Factory that creates a URDecoder for animated QR assembly.
   */
  createURDecoder?: () => URDecoderLike;
  /** Platform-injected sources for scan() when no data is passed. */
  scanSources?: ScanSources;
  /**
   * Device offline (or mock-offline). Used when `enterAmount` omits `offline`;
   * read on each machine event via getter.
   */
  getOffline?: () => boolean;
  /**
   * Returns current BTC price in the user's display currency.
   * Used by the amount entry screen to resolve fiat ↔ sat conversions.
   */
  getBtcPrice?: () => number;
  /**
   * Returns the user's display fiat currency. When non-null, enables the
   * fiat toggle on amount entry screens for send flows.
   */
  getDisplayCurrency?: () => { code: string; symbol: string } | null;
  /**
   * Post-terminal screen action handlers (copy, share, pay, …).
   * Registered on context for `useScreenActions(screenType, entry)`.
   */
  actions?: ScreenActionHandlerMap;
  /**
   * Returns the current locale (e.g. 'en', 'ar', 'de').
   * Used for localized reason messages, date formatting, and RTL truncation.
   * Also used by `screenActionsBridge` when `screenActionsBridge.getLocale`
   * is not set. Defaults to `'en'`.
   */
  getLocale?: () => string;
  /**
   * Custom locale translations. Keys are language codes, values are
   * translation dictionaries mapping reason codes to localized strings.
   * Merged on mount — missing keys fall back to English.
   */
  translations?: Record<string, Record<string, string>>;
  /**
   * Platform clipboard write. When provided, built-in `copy` actions work
   * out of the box — the wallet only needs to handle `onCopied` in
   * `notifications` to show UI feedback.
   */
  writeClipboard?: (text: string) => Promise<void>;
  /**
   * Platform share sheet. When provided, built-in `share` actions work
   * out of the box. Tokens include a `cashu://` URL; other content passes
   * the raw text as `message`.
   */
  shareContent?: (content: { message: string; url?: string }) => Promise<void>;
  /**
   * Optional wallet wiring for `useScreenActions` (extra context, history
   * subscriptions, decoration, scan provenance).
   */
  screenActionsBridge?: ScreenActionsBridge;
  /**
   * Deep link configuration. When provided, the provider automatically
   * processes incoming deep links via the machine's scan() method.
   * `cashu://` is always accepted; pass additional schemes via customSchemes.
   */
  deepLinks?: DeepLinkConfig;
  /**
   * NFC I/O adapter for POS payment flows. When provided,
   * `scan(undefined, { source: 'nfc' })` uses the adapter for read/write
   * and auto-resolves interactive steps without user prompts.
   */
  nfcAdapter?: NfcIOAdapter;
  /**
   * Navigation callbacks for built-in default screen action handlers.
   * When provided alongside operations, screen actions like scanQr, mintInfo,
   * addMint, and goBack work out of the box.
   */
  navigation?: NavigationCallbacks;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface CocoPaymentUXContextValue {
  machine: PaymentMachine;
  walletContextRef: React.MutableRefObject<WalletContext | null>;
  unitRef: React.MutableRefObject<string>;
  optionDismissRef: React.MutableRefObject<(() => void) | undefined>;
  screenActionHandlers: ScreenActionHandlerMap;
  screenActionsBridge: ScreenActionsBridge | undefined;
  getLocaleRef: React.MutableRefObject<(() => string) | undefined>;
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
  operations,
  notifications,
  savePreferredMint,
  saveNpcMint,
  onNpcMintSync,
  detectors,
  walletContextRef: externalWalletContextRef,
  createURDecoder,
  scanSources,
  getLocale,
  translations,
  getOffline,
  getBtcPrice,
  getDisplayCurrency,
  writeClipboard,
  shareContent,
  actions,
  screenActionsBridge,
  deepLinks,
  nfcAdapter,
  navigation,
}: CocoPaymentUXProviderProps) {
  const getLocaleRef = useRef(getLocale);
  getLocaleRef.current = getLocale;

  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;
  const operationsRef = useRef<Partial<MachineOperations> | undefined>(operations);
  operationsRef.current = operations;
  const navigationRef = useRef<NavigationCallbacks | undefined>(navigation);
  navigationRef.current = navigation;
  const writeClipboardRef = useRef(writeClipboard);
  writeClipboardRef.current = writeClipboard;
  const shareContentRef = useRef(shareContent);
  shareContentRef.current = shareContent;

  if (translations) {
    for (const [lang, dict] of Object.entries(translations)) {
      registerLocale(lang, dict);
    }
  }

  const getOfflineRef = useRef(getOffline);
  getOfflineRef.current = getOffline;

  const getBtcPriceRef = useRef(getBtcPrice);
  getBtcPriceRef.current = getBtcPrice;
  const getDisplayCurrencyRef = useRef(getDisplayCurrency);
  getDisplayCurrencyRef.current = getDisplayCurrency;

  const internalWalletContextRef = useRef<WalletContext | null>(null);
  const walletContextRef = externalWalletContextRef ?? internalWalletContextRef;
  const unitRef = useRef('sat');
  const optionDismissRef = useRef<(() => void) | undefined>(undefined);
  const handlersRef = useRef<StepHandlerMap>({});
  const machineRef = useRef<PaymentMachine | null>(null);

  const propsRef = useRef({
    handlersFactory,
    operations,
    notifications,
    savePreferredMint,
    saveNpcMint,
    detectors,
    createURDecoder,
    scanSources,
    getOffline,
    actions,
    screenActionsBridge,
  });
  propsRef.current = {
    handlersFactory,
    operations,
    notifications,
    savePreferredMint,
    saveNpcMint,
    detectors,
    createURDecoder,
    scanSources,
    getOffline,
    actions,
    screenActionsBridge,
  };

  if (!machineRef.current) {
    const {
      handlersFactory: factory,
      operations: ops,
      notifications: notes,
      savePreferredMint: persist,
      saveNpcMint: npcMint,
      detectors: det,
      createURDecoder: ur,
      scanSources: sources,
    } = propsRef.current;

    machineRef.current = createPaymentMachine({
      handlers: new Proxy(
        {},
        {
          get: (_target, key: string) => (handlersRef.current as Record<string, unknown>)[key],
        }
      ) as StepHandlerMap,
      detectors: det,
      getContext: () => {
        if (!walletContextRef.current) {
          throw new Error('CocoPaymentUXProvider has no wallet context bound yet.');
        }
        return walletContextRef.current;
      },
      getUnit: () => unitRef.current,
      getOffline: () => getOfflineRef.current?.() ?? false,
      getLocale: () => getLocaleRef.current?.() ?? 'en',
      onPersistMint: persist,
      onNpcMintChange: npcMint,
      operations: ops,
      notifications: notes,
      createURDecoder: ur,
      scanSources: sources,
      nfcAdapter,
    });

    handlersRef.current = factory(machineRef.current, {
      getOptionDismiss: () => optionDismissRef.current,
    });
  }

  useEffect(() => {
    void onNpcMintSync?.();
  }, [onNpcMintSync]);

  // Deep link processing
  useEffect(() => {
    const url = deepLinks?.url;
    if (!url || !machineRef.current?.scan) return;

    // Extract scheme and host from scheme://host or scheme:host
    const match = url.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*):(?:\/\/)?([^/?#]+)/);
    if (!match) return;

    const scheme = match[1].toLowerCase();
    const host = match[2];

    const accepted = new Set(['cashu', ...(deepLinks.customSchemes ?? [])]);
    if (!accepted.has(scheme)) return;

    const ignored = new Set(deepLinks.ignoredHosts ?? []);
    if (ignored.has(host)) return;

    machineRef.current.scan(host, { source: 'deeplink' }).catch((err) => {
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

export interface UsePaymentFlowMachineConfig {
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

  ctx.walletContextRef.current = walletContext;
  ctx.unitRef.current = unit;

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

/**
 * Returns the mint URL currently tracked by the active payment flow.
 */
export function usePaymentFlowMint(): string | undefined {
  const ctx = usePaymentFlowContext();
  const flowCtx = useSyncExternalStore(
    ctx.machine.subscribe,
    ctx.machine.getContext,
    ctx.machine.getContext
  ) as FlowContext;
  return flowCtx.mintUrl;
}

/**
 * Returns the full mint resolution context for the current flow.
 */
export function usePaymentFlowMintContext({
  walletContext,
  unit = 'sat',
  onOptionDismiss,
}: UsePaymentFlowMachineConfig): MintResolutionContext | null {
  const machine = usePaymentFlowMachine({ walletContext, unit, onOptionDismiss });
  const flowCtx = useSyncExternalStore(machine.subscribe, machine.getContext, machine.getContext);

  return useMemo(() => selectMintContext(flowCtx, walletContext), [flowCtx, walletContext]);
}
