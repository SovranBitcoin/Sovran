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
  useSyncExternalStore,
} from "react";

import { useLatestRef } from "./useLatestRef";
import {
  createInMemoryAnnotationStore,
  encodeAnnotation,
  type AnnotationEntryLike,
  type AnnotationStoreAdapter,
  type TransactionAnnotation,
} from "../annotations";
import { annotationKey as deriveAnnotationKey } from "../annotations";
import { createPaymentCopyResolver, registerPaymentCopyLocale } from "../copy";
import type { PaymentCopyCatalog, PaymentCopyResolver } from "../copy";
import { registerLocale } from "../formatting/locales";
import { errField, logger, setLogger } from "../logger";
import { createPaymentMachine } from "../machine/createMachine";
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
} from "../adapters/types";
import type { Manager } from "@cashu/coco-core";
import type {
  MachineOperations,
  NotificationHandlerMap,
  PaymentMachine,
  ScanSourceResult,
  ScanSources,
  StepHandlerMap,
} from "../machine/types";
import type {
  ScreenActionHandlerMap,
  ScreenActionsBridge,
} from "../screen-actions/types";
import type { NavigationCallbacks } from "../screen-actions/defaultHandlers";
import { createSubscriptionBus } from "../subscriptions";
import type { ColadaSubscriptionBus } from "../subscriptions";
import type { Detectors, WalletContext } from "../types";
import type { ColadaInstance } from "../core/createColada";

export type { ScreenActionsBridge } from "../screen-actions/types";

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
  /**
   * Called after URL validation and immediately before the machine scan. Apps
   * can use this dependency-inverted seam to clear app-owned routing context.
   */
  onBeforeScan?: () => void;
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
  /**
   * Accessor for the live coco `Manager`. Enables colada's read hooks
   * (`useColadaTransactions`, `useColadaBalance`) without depending on a
   * specific coco React binding. The wallet owns the manager lifecycle.
   */
  getManager?: () => Manager | null;
  /**
   * Persistence for transaction annotations (per-transaction side-data the coco
   * core does not store: counterparty, scan source, P2PK lock, distribution,
   * location, swap grouping). The wallet owns persistence + profile-scoping; if
   * omitted, an in-memory adapter is used (annotations won't survive restart).
   */
  annotationStore?: AnnotationStoreAdapter;
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
   * The wallet's ACTIVE unit. This is the authoritative default the flow
   * reset reads — a screen binding an explicit `unit` via
   * `usePaymentFlowMachine({ unit })` overrides it only while that screen is
   * mounted. Without this getter (and no explicit binding), 'sat' is used.
   */
  getUnit?: () => string;
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
  walletContextSource: Pick<
    ColadaInstance,
    "getWalletContext" | "subscribeWalletContext"
  > | null;
  walletContextRef: React.MutableRefObject<WalletContext | null>;
  unitRef: React.MutableRefObject<string | undefined>;
  optionDismissRef: React.MutableRefObject<(() => void) | undefined>;
  screenActionHandlers: ScreenActionHandlerMap;
  screenActionsBridge: ScreenActionsBridge | undefined;
  getLocaleRef: React.MutableRefObject<(() => string) | undefined>;
  getOfflineRef: React.MutableRefObject<(() => boolean) | undefined>;
  getBtcPriceRef: React.MutableRefObject<(() => number) | undefined>;
  getDisplayCurrencyRef: React.MutableRefObject<
    (() => { code: string; symbol: string } | null) | undefined
  >;
  paymentCopyOverridesRef: React.MutableRefObject<
    Partial<PaymentCopyCatalog> | undefined
  >;
  adaptersRef: React.MutableRefObject<ColadaAdapters>;
  getManagerRef: React.MutableRefObject<(() => Manager | null) | undefined>;
  annotationStoreRef: React.MutableRefObject<AnnotationStoreAdapter>;
  subscriptionBusRef: React.MutableRefObject<ColadaSubscriptionBus>;
  notificationsRef: React.MutableRefObject<NotificationHandlerMap | undefined>;
  operationsRef: React.MutableRefObject<Partial<MachineOperations> | undefined>;
  navigationRef: React.MutableRefObject<NavigationCallbacks | undefined>;
  writeClipboardRef: React.MutableRefObject<
    ((text: string) => Promise<void>) | undefined
  >;
  shareContentRef: React.MutableRefObject<
    ((content: { message: string; url?: string }) => Promise<void>) | undefined
  >;
}

const ColadaContext = createContext<ColadaContextValue | null>(null);

const EMPTY_SCREEN_ACTIONS = {} as ScreenActionHandlerMap;

function scanSourceFromClipboard(
  adapter: ClipboardAdapter,
): () => Promise<ScanSourceResult> {
  return async () => {
    logger.debug("react.clipboardScan.start", {
      hasReadText: !!adapter.readText,
    });
    if (!adapter.readText) {
      logger.debug("react.clipboardScan.result", {
        empty: true,
        reason: "missing_adapter",
      });
      return { empty: true };
    }
    try {
      const data = await adapter.readText();
      if (data && data.trim()) {
        logger.info("react.clipboardScan.result", {
          empty: false,
          dataLength: data.length,
          trimmedLength: data.trim().length,
        });
        return { data };
      }
      logger.debug("react.clipboardScan.result", {
        empty: true,
        reason: "empty_clipboard",
      });
      return { empty: true };
    } catch (error) {
      logger.warn("react.clipboardScan.failed", { error: errField(error) });
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

function summarizeWalletContext(
  context: WalletContext,
): Record<string, unknown> {
  return {
    trustedMintCount: context.trustedMintUrls.length,
    balanceMintCount: Object.keys(context.mintBalances).length,
    proofMintCount: Object.keys(context.proofAmounts).length,
    readyProofCount: Object.values(context.proofAmounts).reduce(
      (sum, proofs) => sum + proofs.length,
      0,
    ),
    hasPreferredMint: !!context.preferredMintUrl,
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ColadaProvider({
  children,
  handlers: handlersFactory,
  instance,
  getManager: getManagerProp,
  annotationStore: annotationStoreProp,
  operations: operationsProp,
  detectors,
  notifications,
  actions,
  screenActionsBridge,
  getOffline: getOfflineProp,
  getUnit: getUnitProp,
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
  const enableEcashSendMemo =
    enableEcashSendMemoProp ?? ic?.enableEcashSendMemo ?? false;
  const getBtcPrice = getBtcPriceProp ?? ic?.getBtcPrice;
  const getDisplayCurrency = getDisplayCurrencyProp ?? ic?.getDisplayCurrency;
  const getSatsPerUnitMinor = ic?.getSatsPerUnitMinor;
  const writeClipboard = clipboardAdapter?.writeText;
  const shareContent = shareAdapter
    ? (content: { message: string; url?: string }) =>
        shareAdapter.share(content)
    : undefined;
  const adapterScanSources = useMemo(
    () =>
      buildAdapterScanSources({
        clipboardAdapter,
        imagePickerAdapter,
      }),
    [clipboardAdapter, imagePickerAdapter],
  );
  const scanSources = useMemo(
    () => scanSourcesProp ?? adapterScanSources,
    [adapterScanSources, scanSourcesProp],
  );
  const nfcAdapter = nfcAdapterProp;
  const createURDecoder = qrDecoderAdapter?.createUrDecoder;
  const subscriptionBus = useMemo(() => createSubscriptionBus(), []);
  const baseOperations = operationsProp ?? instance?.operations;
  const operations = useMemo<Partial<MachineOperations> | undefined>(() => {
    if (!nostrAdapter?.sendDirectMessage && !nostrAdapter?.resolveProfile) {
      return baseOperations;
    }
    logger.info("react.provider.operations.override", {
      hasBaseOperations: !!baseOperations,
      hasNostrSendDirectMessage: !!nostrAdapter.sendDirectMessage,
      hasNostrResolveProfile: !!nostrAdapter.resolveProfile,
    });
    return {
      ...baseOperations,
      sendNostrDM:
        nostrAdapter.sendDirectMessage ?? baseOperations?.sendNostrDM,
      resolveRecipientProfile:
        nostrAdapter.resolveProfile ?? baseOperations?.resolveRecipientProfile,
    };
  }, [baseOperations, nostrAdapter]);

  const getLocaleRef = useLatestRef(getLocale);
  const paymentCopyOverridesRef = useLatestRef<
    Partial<PaymentCopyCatalog> | undefined
  >(paymentCopyOverrides);
  const adaptersRef = useLatestRef(adapters);
  // Prefer an explicit getManager prop; otherwise fall back to the manager the
  // createColada instance already holds, so wallets get read hooks for free.
  const getManagerRef = useLatestRef<(() => Manager | null) | undefined>(
    getManagerProp ??
      (instance ? () => instance.config.manager ?? null : undefined),
  );
  // Annotation persistence: explicit prop wins, else the createColada instance's
  // adapter, else a lazily-created in-memory default (stable for this mount).
  const defaultAnnotationStoreRef = useRef<AnnotationStoreAdapter | undefined>(
    undefined,
  );
  if (!defaultAnnotationStoreRef.current) {
    defaultAnnotationStoreRef.current = createInMemoryAnnotationStore();
  }
  const annotationStoreRef = useLatestRef<AnnotationStoreAdapter>(
    annotationStoreProp ??
      instance?.config.annotationStore ??
      defaultAnnotationStoreRef.current,
  );
  const subscriptionBusRef = useLatestRef(subscriptionBus);
  const notificationsRef = useLatestRef(notifications);
  const operationsRef = useLatestRef<Partial<MachineOperations> | undefined>(
    operations,
  );
  const navigationRef = useLatestRef<NavigationCallbacks | undefined>(
    navigation,
  );
  const writeClipboardRef = useLatestRef(writeClipboard);
  const shareContentRef = useLatestRef(shareContent);

  const getOfflineRef = useLatestRef(getOffline);
  const getBtcPriceRef = useLatestRef(getBtcPrice);
  const getDisplayCurrencyRef = useLatestRef(getDisplayCurrency);
  const getSatsPerUnitMinorRef = useLatestRef(getSatsPerUnitMinor);

  const walletContextRef = useRef<WalletContext | null>(null);
  const getUnitRef = useLatestRef(getUnitProp);
  // Explicit per-screen unit override (usePaymentFlowMachine({ unit })).
  // undefined = no override — the flow reset falls back to the app's
  // authoritative getUnit prop. Screens must NOT be defaulted into 'sat'
  // here: a unit-less binding used to clobber this ref and freeze the wrong
  // unit into the next flow reset (first-open-wrong-unit bug).
  const unitRef = useRef<string | undefined>(undefined);
  const optionDismissRef = useRef<(() => void) | undefined>(undefined);
  const handlersRef = useRef<StepHandlerMap>({});
  const machineRef = useRef<PaymentMachine | null>(null);

  useEffect(() => {
    logger.info("react.provider.config", {
      hasInstance: !!instance,
      hasOperationsProp: !!operationsProp,
      operationCount: Object.keys(operations ?? {}).length,
      detectorOverride: !!detectors,
      notificationCount: Object.keys(notifications ?? {}).length,
      actionScreenCount: Object.keys(actions ?? {}).length,
      hasScreenActionsBridge: !!screenActionsBridge,
      hasOfflineGetter: !!getOffline,
      enableEcashSendMemo,
      hasBtcPriceGetter: !!getBtcPrice,
      hasDisplayCurrencyGetter: !!getDisplayCurrency,
      hasLocaleGetter: !!getLocale,
      adapterScanSourceCount: Object.keys(adapterScanSources ?? {}).length,
      scanSourceCount: Object.keys(scanSources ?? {}).length,
      hasNfcAdapter: !!nfcAdapter,
      hasUrDecoder: !!createURDecoder,
      hasDeepLinks: !!deepLinks,
      hasLoggerAdapter: !!loggerAdapter,
    });
  }, [
    actions,
    adapterScanSources,
    createURDecoder,
    deepLinks,
    detectors,
    enableEcashSendMemo,
    getBtcPrice,
    getDisplayCurrency,
    getLocale,
    getOffline,
    instance,
    loggerAdapter,
    nfcAdapter,
    notifications,
    operations,
    operationsProp,
    scanSources,
    screenActionsBridge,
  ]);

  // Translations register on a module-level locale map. Run as an effect so
  // the side effect happens after commit (StrictMode double-invoke of render
  // would otherwise duplicate the work and re-allocate Object.entries each
  // render).
  useEffect(() => {
    if (!translations) return;
    logger.info("react.provider.translations.register", {
      localeCount: Object.keys(translations).length,
      locales: Object.keys(translations),
    });
    for (const [lang, dict] of Object.entries(translations)) {
      registerLocale(lang, dict);
      registerPaymentCopyLocale(lang, dict);
    }
  }, [translations]);

  useEffect(() => {
    if (!loggerAdapter) return undefined;
    logger.info("react.provider.logger.bind");
    setLogger(loggerAdapter);
    return () => {
      logger.info("react.provider.logger.unbind");
      setLogger(null);
    };
  }, [loggerAdapter]);

  useEffect(() => {
    logger.info("react.provider.subscriptionBus.bind", {
      hasBridge: !!screenActionsBridge,
    });
    return screenActionsBridge?.bindSubscriptionBus?.(subscriptionBus);
  }, [screenActionsBridge, subscriptionBus]);

  if (!machineRef.current) {
    logger.info("react.provider.machine.create", {
      hasInstance: !!instance,
      detectorOverride: !!detectors,
      operationCount: Object.keys(operations ?? {}).length,
      notificationCount: Object.keys(notifications ?? {}).length,
      hasNfcAdapter: !!nfcAdapter,
      scanSourceCount: Object.keys(scanSources ?? {}).length,
      enableEcashSendMemo,
    });
    machineRef.current = createPaymentMachine({
      handlers: new Proxy(
        {},
        {
          get: (_target, key: string) =>
            (handlersRef.current as Record<string, unknown>)[key],
        },
      ) as StepHandlerMap,
      detectors,
      getContext: instance
        ? () => instance.tracker.getContext()
        : () => {
            if (!walletContextRef.current) {
              throw new Error(
                "ColadaProvider has no wallet context bound yet.",
              );
            }
            return walletContextRef.current;
          },
      getUnit: () => unitRef.current ?? getUnitRef.current?.() ?? "sat",
      getOffline: () => getOfflineRef.current?.() ?? false,
      getSatsPerUnitMinor: (unit) =>
        getSatsPerUnitMinorRef.current?.(unit) ?? null,
      enableEcashSendMemo,
      getLocale: () => getLocaleRef.current?.() ?? "en",
      operations: operations as MachineOperations | undefined,
      notifications,
      createURDecoder,
      scanSources,
      nfcAdapter,
    });

    handlersRef.current = handlersFactory(machineRef.current, {
      getOptionDismiss: () => optionDismissRef.current,
    });
    logger.info("react.provider.machine.ready", {
      handlerCount: Object.keys(handlersRef.current).length,
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
    logger.debug("react.provider.handlers.bound", {
      handlerCount: Object.keys(handlersRef.current).length,
    });
  }, [handlersFactory]);

  // Deep link processing
  useEffect(() => {
    const url = deepLinks?.url;
    if (!url || !machineRef.current?.scan) return;

    // Extract scheme and host from scheme://host or scheme:host
    const match = url.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*):(?:\/\/)?([^/?#]+)/);
    if (!match) {
      logger.warn("deepLink.parse.failed", { urlLength: url.length });
      return;
    }

    const scheme = match[1].toLowerCase();
    const host = match[2];

    // URI schemes are case-insensitive (RFC 3986 §3.1) and we already
    // lowercased the parsed scheme — so the lookup set must be lowercase
    // too. A wallet passing `customSchemes: ['Cashu']` would otherwise
    // never match.
    const accepted = new Set([
      "cashu",
      ...(deepLinks.customSchemes ?? []).map((s) => s.toLowerCase()),
    ]);
    if (!accepted.has(scheme)) {
      logger.debug("deepLink.ignored", {
        reason: "scheme_not_accepted",
        scheme,
        hostLength: host.length,
      });
      return;
    }

    const ignored = new Set(deepLinks.ignoredHosts ?? []);
    if (ignored.has(host)) {
      logger.debug("deepLink.ignored", {
        reason: "host_ignored",
        scheme,
        hostLength: host.length,
      });
      return;
    }

    if (host.length > DEEP_LINK_HOST_MAX_LENGTH) {
      logger.warn("deepLink.host.too_long", { length: host.length });
      deepLinks.onError?.(new Error("DEEP_LINK_TOO_LONG"));
      return;
    }

    logger.info("deepLink.scan.start", {
      scheme,
      hostLength: host.length,
      customSchemeCount: deepLinks.customSchemes?.length ?? 0,
    });
    deepLinks.onBeforeScan?.();
    machineRef.current.scan(host, { source: "deeplink" }).catch((err) => {
      logger.warn("deepLink.scan.failed", {
        scheme,
        hostLength: host.length,
        error: errField(err),
      });
      deepLinks.onError?.(err instanceof Error ? err : new Error(String(err)));
    });
  }, [deepLinks?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const screenActionHandlers = actions ?? EMPTY_SCREEN_ACTIONS;

  const value = useMemo<ColadaContextValue>(
    () => ({
      machine: machineRef.current!,
      walletContextSource: instance ?? null,
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
      getManagerRef,
      annotationStoreRef,
      subscriptionBusRef,
      notificationsRef,
      operationsRef,
      navigationRef,
      writeClipboardRef,
      shareContentRef,
    }),
    [
      walletContextRef,
      instance,
      screenActionHandlers,
      screenActionsBridge,
      paymentCopyOverridesRef,
      adaptersRef,
      subscriptionBusRef,
    ],
  );

  return (
    <ColadaContext.Provider value={value}>{children}</ColadaContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Context accessor
// ---------------------------------------------------------------------------

export function useColadaContext(): ColadaContextValue {
  const ctx = useContext(ColadaContext);
  if (!ctx) {
    throw new Error(
      "ColadaProvider is missing. Wrap the app with ColadaProvider.",
    );
  }
  return ctx;
}

export function useColadaSubscriptions(): ColadaSubscriptionBus {
  return useColadaContext().subscriptionBusRef.current;
}

type ColadaWalletContextSource = Pick<
  ColadaInstance,
  "getWalletContext" | "subscribeWalletContext"
>;

/** Stable external-store adapter kept separate so subscription behavior is testable without React. */
export function createColadaTrustedMintUrlsStore(
  source: ColadaWalletContextSource | null,
) {
  return {
    subscribe: source
      ? source.subscribeWalletContext
      : (_listener: () => void) => () => undefined,
    getSnapshot: source
      ? () => source.getWalletContext().trustedMintUrls
      : () => null,
  };
}

/**
 * Trusted-mint URLs from the same tracker snapshot the shared payment machine
 * reads. Returns null when ColadaProvider is running without a createColada
 * instance, allowing callers to fall back to their explicitly-bound context.
 */
export function useColadaTrustedMintUrls(): readonly string[] | null {
  const source = useColadaContext().walletContextSource;
  const store = useMemo(
    () => createColadaTrustedMintUrlsStore(source),
    [source],
  );
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

/**
 * The live coco `Manager`, for colada's read hooks. Requires the wallet to pass
 * `getManager` (or a `createColada` instance) to `ColadaProvider`.
 */
export function useColadaManager(): Manager {
  const manager = useColadaContext().getManagerRef.current?.();
  if (!manager) {
    throw new Error(
      "colada manager is unavailable. Pass `getManager` (or a createColada `instance`) to ColadaProvider.",
    );
  }
  return manager;
}

/**
 * The annotation persistence adapter (per-transaction side-data). Falls back to
 * an in-memory adapter when the wallet didn't supply one.
 */
export function useAnnotationStore(): AnnotationStoreAdapter {
  return useColadaContext().annotationStoreRef.current;
}

export interface SetTransactionAnnotation {
  /**
   * Write an annotation patch. `target` is either an explicit key
   * (`raw:...`, `quote:...`, `op:...`, `id:...`) or an entry whose canonical
   * key is derived. Patches are additive at the field level.
   */
  set: (
    target: string | AnnotationEntryLike,
    patch: TransactionAnnotation,
  ) => void;
  /**
   * Bridge a preview-time key (e.g. a `raw:` scan key) onto the final entry's
   * key once it exists, so the annotation resolves for the persisted row.
   */
  linkAnnotation: (
    fromKey: string,
    toKey: string | AnnotationEntryLike,
  ) => void;
}

/**
 * Writer for transaction annotations. The app calls this during payment flows
 * when it learns side-data coco never stores (counterparty, scan source, P2PK
 * lock, distribution, location, swap).
 */
export function useSetTransactionAnnotation(): SetTransactionAnnotation {
  const store = useAnnotationStore();
  return useMemo<SetTransactionAnnotation>(
    () => ({
      set: (target, patch) => {
        const key =
          typeof target === "string" ? target : deriveAnnotationKey(target);
        store.set(key, encodeAnnotation(patch));
      },
      linkAnnotation: (fromKey, toKey) => {
        const record = store.get(fromKey);
        if (!record) return;
        const key =
          typeof toKey === "string" ? toKey : deriveAnnotationKey(toKey);
        store.set(key, record);
      },
    }),
    [store],
  );
}

export function usePaymentCopy(): PaymentCopyResolver {
  const ctx = useContext(ColadaContext);
  const locale = ctx?.getLocaleRef.current?.() ?? "en";
  const overrides = ctx?.paymentCopyOverridesRef.current;
  return useMemo(
    () => createPaymentCopyResolver({ locale, overrides }),
    [locale, overrides],
  );
}

function usePaymentFlowContext(): ColadaContextValue {
  return useColadaContext();
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

interface UsePaymentFlowMachineConfig {
  walletContext: WalletContext;
  /**
   * Explicit unit override for flows started while this screen is bound
   * (e.g. NearPay pins 'sat'). Omit to use the provider's `getUnit` — the
   * app's live active unit. Do NOT pass the active unit redundantly: the
   * override is last-binder-wins across mounted screens, so redundant
   * bindings can clobber each other.
   */
  unit?: string;
  onOptionDismiss?: () => void;
}

/**
 * Binds the current screen's wallet context and unit to the shared machine.
 * Returns the stable PaymentMachine instance.
 */
export function usePaymentFlowMachine({
  walletContext,
  unit,
  onOptionDismiss,
}: UsePaymentFlowMachineConfig): PaymentMachine {
  const ctx = usePaymentFlowContext();

  // Refs are written in useEffect (not during render) so concurrent renders
  // that get discarded — transition aborted, suspense fallback — don't mutate
  // shared provider state with values that were never committed.
  useEffect(() => {
    ctx.walletContextRef.current = walletContext;
    logger.debug("react.paymentFlowMachine.bindContext", {
      unit: unit ?? null,
      ...summarizeWalletContext(walletContext),
    });
    if (unit === undefined) return;
    ctx.unitRef.current = unit;
    return () => {
      // Release the override when this binder unmounts (or changes unit) so
      // a stale explicit unit can't leak into a later flow's reset. Guarded
      // so we never clear a different screen's newer override.
      if (ctx.unitRef.current === unit) {
        ctx.unitRef.current = undefined;
      }
    };
  }, [ctx, walletContext, unit]);

  useEffect(() => {
    ctx.optionDismissRef.current = onOptionDismiss;
    logger.debug("react.paymentFlowMachine.bindOptionDismiss", {
      hasOptionDismiss: !!onOptionDismiss,
    });
    return () => {
      if (ctx.optionDismissRef.current === onOptionDismiss) {
        ctx.optionDismissRef.current = undefined;
        logger.debug("react.paymentFlowMachine.clearOptionDismiss");
      }
    };
  }, [ctx, onOptionDismiss]);

  return ctx.machine;
}
