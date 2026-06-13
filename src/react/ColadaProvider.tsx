// ---------------------------------------------------------------------------
// ColadaProvider — React context + hooks for the payment flow machine
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
import { createPaymentCopyResolver, registerPaymentCopyLocale } from '../copy';
import type { PaymentCopyCatalog, PaymentCopyResolver } from '../copy';
import { registerLocale } from '../formatting/locales';
import { errField, logger, setLogger } from '../logger';
import { createPaymentMachine } from '../machine/createMachine';
import type {
  BleAdapter,
  CameraAdapter,
  ChainAdapter,
  ClipboardAdapter,
  ClockAdapter,
  HapticsAdapter,
  ImagePickerAdapter,
  LoggerAdapter,
  NfcAdapter,
  NotificationsAdapter as SideEffectNotificationsAdapter,
  NostrAdapter,
  QrDecoderAdapter,
  QrEncoderAdapter,
  RandomAdapter,
  SecureStorageAdapter,
  ShareAdapter,
  StorageAdapter,
  ColadaAdapters,
} from '../adapters/types';
import type {
  MachineOperations,
  NotificationHandlerMap,
  PaymentMachine,
  ScanSourceResult,
  ScanSources,
  StepHandlerMap,
} from '../machine/types';
import type { MeshTransportAdapter } from '../transport/types';
import type { ScreenActionHandlerMap, ScreenActionsBridge } from '../screen-actions/types';
import type { NavigationCallbacks } from '../screen-actions/defaultHandlers';
import { createSubscriptionBus } from '../subscriptions';
import type { ColadaSubscriptionBus } from '../subscriptions';
import type { Detectors, WalletContext } from '../types';
import type { ColadaInstance } from '../core/createColada';

export type { ScreenActionsBridge } from '../screen-actions/types';

/**
 * Defence-in-depth cap on deep-link host length. The OS typically caps intent
 * URL length around a few KB; this keeps a malicious app from inducing
 * unbounded scan-pipeline work via a prepared intent.
 */
const DEEP_LINK_HOST_MAX_LENGTH = 16384;

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

/**
 * Live refs exposed to the handler factory so handlers can read
 * values that change after creation (e.g. option dismiss callback).
 */
export interface PaymentFlowRefs {
  getOptionDismiss: () => (() => void) | undefined;
}

export interface ColadaProviderProps {
  children: React.ReactNode;
  /**
   * Required step-handler factory. Called once after the machine is
   * created — returns the `StepHandlerMap` it will use.
   */
  handlers: (machine: PaymentMachine, refs: PaymentFlowRefs) => StepHandlerMap;
  /** Engine instance from `createColada()`. */
  instance?: ColadaInstance;
  /** Operation overrides. Top-level value wins over `instance.operations`. */
  operations?: MachineOperations;
  /** Custom protocol detectors. */
  detectors?: Detectors;
  /** Error/validation/state notifications emitted by the payment machine. */
  notifications?: NotificationHandlerMap;
  /** Post-terminal screen action handlers. */
  actions?: ScreenActionHandlerMap;
  /** Optional app bridge for `useScreenActions` enrichment/subscriptions. */
  screenActionsBridge?: ScreenActionsBridge;
  getOffline?: () => boolean;
  /**
   * Mesh transport adapter getter for `startMeshSend` (Nut Drop). Falls back
   * to `instance.config.getMeshTransport`. A getter because the adapter's
   * lifetime tracks the mesh radio, not the provider.
   */
  getMeshTransport?: () => MeshTransportAdapter | null;
  enableEcashSendMemo?: boolean;
  getBtcPrice?: () => number;
  getDisplayCurrency?: () => { code: string; symbol: string } | null;
  getLocale?: () => string;
  translations?: Record<string, Record<string, string>>;
  /** Per-key app copy overrides for the active locale. */
  paymentCopyOverrides?: Partial<PaymentCopyCatalog>;
  clipboardAdapter?: ClipboardAdapter;
  shareAdapter?: ShareAdapter;
  cameraAdapter?: CameraAdapter;
  imagePickerAdapter?: ImagePickerAdapter;
  hapticsAdapter?: HapticsAdapter;
  notificationsAdapter?: SideEffectNotificationsAdapter;
  nostrAdapter?: NostrAdapter;
  bleAdapter?: BleAdapter;
  nfcAdapter?: NfcAdapter;
  chainAdapter?: ChainAdapter;
  storageAdapter?: StorageAdapter;
  secureStorageAdapter?: SecureStorageAdapter;
  qrEncoderAdapter?: QrEncoderAdapter;
  qrDecoderAdapter?: QrDecoderAdapter;
  clockAdapter?: ClockAdapter;
  randomAdapter?: RandomAdapter;
  loggerAdapter?: LoggerAdapter;
  /** Explicit scan sources override adapter-derived scan sources. */
  scanSources?: ScanSources;
  /** Automatic deep-link processing. */
  deepLinks?: DeepLinkConfig;
  /** Default screen-action navigation callbacks. */
  navigation?: NavigationCallbacks;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ColadaContextValue {
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
  paymentCopyOverridesRef: React.MutableRefObject<Partial<PaymentCopyCatalog> | undefined>;
  adaptersRef: React.MutableRefObject<ColadaAdapters>;
  subscriptionBusRef: React.MutableRefObject<ColadaSubscriptionBus>;
  notificationsRef: React.MutableRefObject<NotificationHandlerMap | undefined>;
  operationsRef: React.MutableRefObject<Partial<MachineOperations> | undefined>;
  navigationRef: React.MutableRefObject<NavigationCallbacks | undefined>;
  writeClipboardRef: React.MutableRefObject<((text: string) => Promise<void>) | undefined>;
  shareContentRef: React.MutableRefObject<
    ((content: { message: string; url?: string }) => Promise<void>) | undefined
  >;
}

const ColadaContext = createContext<ColadaContextValue | null>(null);

const EMPTY_SCREEN_ACTIONS = {} as ScreenActionHandlerMap;

function scanSourceFromClipboard(adapter: ClipboardAdapter): () => Promise<ScanSourceResult> {
  return async () => {
    if (!adapter.readText) return { empty: true };
    try {
      const data = await adapter.readText();
      return data && data.trim() ? { data } : { empty: true };
    } catch (error) {
      return {
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  };
}

function buildAdapterScanSources(args: {
  clipboardAdapter?: ClipboardAdapter;
  imagePickerAdapter?: ImagePickerAdapter;
}): ScanSources | undefined {
  const sources: ScanSources = {};
  if (args.clipboardAdapter?.readText) {
    sources.clipboard = scanSourceFromClipboard(args.clipboardAdapter);
  }
  if (args.imagePickerAdapter) {
    sources.gallery = args.imagePickerAdapter.pickQrImage;
  }
  return Object.keys(sources).length > 0 ? sources : undefined;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ColadaProvider({
  children,
  handlers: handlersFactory,
  instance,
  operations: operationsProp,
  detectors,
  notifications,
  actions,
  screenActionsBridge,
  getOffline: getOfflineProp,
  getMeshTransport: getMeshTransportProp,
  enableEcashSendMemo: enableEcashSendMemoProp,
  getBtcPrice: getBtcPriceProp,
  getDisplayCurrency: getDisplayCurrencyProp,
  getLocale: getLocaleProp,
  translations,
  paymentCopyOverrides,
  clipboardAdapter,
  shareAdapter,
  cameraAdapter,
  imagePickerAdapter,
  hapticsAdapter,
  notificationsAdapter,
  nostrAdapter,
  bleAdapter,
  nfcAdapter: nfcAdapterProp,
  chainAdapter,
  storageAdapter,
  secureStorageAdapter,
  qrEncoderAdapter,
  qrDecoderAdapter,
  clockAdapter,
  randomAdapter,
  loggerAdapter,
  scanSources: scanSourcesProp,
  deepLinks,
  navigation,
}: ColadaProviderProps) {
  const adapters = useMemo<ColadaAdapters>(
    () => ({
      clipboardAdapter,
      shareAdapter,
      cameraAdapter,
      imagePickerAdapter,
      hapticsAdapter,
      notificationsAdapter,
      nostrAdapter,
      bleAdapter,
      nfcAdapter: nfcAdapterProp,
      chainAdapter,
      storageAdapter,
      secureStorageAdapter,
      qrEncoderAdapter,
      qrDecoderAdapter,
      clockAdapter,
      randomAdapter,
      loggerAdapter,
    }),
    [
      clipboardAdapter,
      shareAdapter,
      cameraAdapter,
      imagePickerAdapter,
      hapticsAdapter,
      notificationsAdapter,
      nostrAdapter,
      bleAdapter,
      nfcAdapterProp,
      chainAdapter,
      storageAdapter,
      secureStorageAdapter,
      qrEncoderAdapter,
      qrDecoderAdapter,
      clockAdapter,
      randomAdapter,
      loggerAdapter,
    ],
  );

  // Flat props win over values carried by the createColada instance. The
  // instance fallback lets core operations keep owning wallet context while
  // provider consumers move away from grouped React props.
  const ic = instance?.config;
  const getLocale = getLocaleProp ?? ic?.getLocale;
  const getOffline = getOfflineProp ?? ic?.getOffline;
  const getMeshTransport = getMeshTransportProp ?? ic?.getMeshTransport;
  const enableEcashSendMemo = enableEcashSendMemoProp ?? ic?.enableEcashSendMemo ?? false;
  const getBtcPrice = getBtcPriceProp ?? ic?.getBtcPrice;
  const getDisplayCurrency = getDisplayCurrencyProp ?? ic?.getDisplayCurrency;
  const writeClipboard = clipboardAdapter?.writeText;
  const shareContent = shareAdapter
    ? (content: { message: string; url?: string }) => shareAdapter.share(content)
    : undefined;
  const adapterScanSources = buildAdapterScanSources({
    clipboardAdapter,
    imagePickerAdapter,
  });
  const scanSources = scanSourcesProp ?? adapterScanSources;
  const nfcAdapter = nfcAdapterProp;
  const createURDecoder = qrDecoderAdapter?.createUrDecoder;
  const subscriptionBus = useMemo(() => createSubscriptionBus(), []);
  const baseOperations = operationsProp ?? instance?.operations;
  const operations = useMemo<Partial<MachineOperations> | undefined>(() => {
    if (!nostrAdapter?.sendDirectMessage && !nostrAdapter?.resolveProfile) {
      return baseOperations;
    }
    return {
      ...baseOperations,
      sendNostrDM: nostrAdapter.sendDirectMessage ?? baseOperations?.sendNostrDM,
      resolveRecipientProfile:
        nostrAdapter.resolveProfile ?? baseOperations?.resolveRecipientProfile,
    };
  }, [baseOperations, nostrAdapter]);

  const getLocaleRef = useLatestRef(getLocale);
  const paymentCopyOverridesRef =
    useLatestRef<Partial<PaymentCopyCatalog> | undefined>(paymentCopyOverrides);
  const adaptersRef = useLatestRef(adapters);
  const subscriptionBusRef = useLatestRef(subscriptionBus);
  const notificationsRef = useLatestRef(notifications);
  const operationsRef = useLatestRef<Partial<MachineOperations> | undefined>(operations);
  const navigationRef = useLatestRef<NavigationCallbacks | undefined>(navigation);
  const writeClipboardRef = useLatestRef(writeClipboard);
  const shareContentRef = useLatestRef(shareContent);

  const getOfflineRef = useLatestRef(getOffline);
  const getMeshTransportRef = useLatestRef(getMeshTransport);
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
      registerPaymentCopyLocale(lang, dict);
    }
  }, [translations]);

  useEffect(() => {
    if (!loggerAdapter) return undefined;
    setLogger(loggerAdapter);
    return () => setLogger(null);
  }, [loggerAdapter]);

  useEffect(() => {
    return screenActionsBridge?.bindSubscriptionBus?.(subscriptionBus);
  }, [screenActionsBridge, subscriptionBus]);

  if (!machineRef.current) {
    machineRef.current = createPaymentMachine({
      handlers: new Proxy(
        {},
        {
          get: (_target, key: string) => (handlersRef.current as Record<string, unknown>)[key],
        },
      ) as StepHandlerMap,
      detectors,
      getContext: instance
        ? () => instance.tracker.getContext()
        : () => {
            if (!walletContextRef.current) {
              throw new Error('ColadaProvider has no wallet context bound yet.');
            }
            return walletContextRef.current;
          },
      getUnit: () => unitRef.current,
      getOffline: () => getOfflineRef.current?.() ?? false,
      getMeshTransport: () => getMeshTransportRef.current?.() ?? null,
      enableEcashSendMemo,
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

  const value = useMemo<ColadaContextValue>(
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
      paymentCopyOverridesRef,
      adaptersRef,
      subscriptionBusRef,
      notificationsRef,
      operationsRef,
      navigationRef,
      writeClipboardRef,
      shareContentRef,
    }),
    [
      walletContextRef,
      screenActionHandlers,
      screenActionsBridge,
      paymentCopyOverridesRef,
      adaptersRef,
      subscriptionBusRef,
    ],
  );

  return <ColadaContext.Provider value={value}>{children}</ColadaContext.Provider>;
}

// ---------------------------------------------------------------------------
// Context accessor
// ---------------------------------------------------------------------------

export function useColadaContext(): ColadaContextValue {
  const ctx = useContext(ColadaContext);
  if (!ctx) {
    throw new Error('ColadaProvider is missing. Wrap the app with ColadaProvider.');
  }
  return ctx;
}

export function useColadaSubscriptions(): ColadaSubscriptionBus {
  return useColadaContext().subscriptionBusRef.current;
}

export function usePaymentCopy(): PaymentCopyResolver {
  const ctx = useContext(ColadaContext);
  const locale = ctx?.getLocaleRef.current?.() ?? 'en';
  const overrides = ctx?.paymentCopyOverridesRef.current;
  return useMemo(() => createPaymentCopyResolver({ locale, overrides }), [locale, overrides]);
}

function usePaymentFlowContext(): ColadaContextValue {
  return useColadaContext();
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
