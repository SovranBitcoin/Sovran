// ---------------------------------------------------------------------------
// createColada — framework-agnostic factory
//
// Accepts a coco-cashu-core Manager and returns a fully operational instance
// with built-in operations, WalletContext tracking, and the PaymentMachine.
//
// This is the primary entry point for integrating colada. The wallet
// provides a Manager (from coco-cashu-core) and app-owned enrichment callbacks;
// the instance does everything else.
// ---------------------------------------------------------------------------

import type { Manager } from "@cashu/coco-core";
import type { AnnotationStoreAdapter } from "../annotations";
import { createPaymentMachine } from "../machine/createMachine";
import { logger, setLogger, type CocoLogger } from "../logger";
import type {
  MachineOperations,
  NfcIOAdapter,
  NotificationHandlerMap,
  PaymentMachine,
  ScanSources,
  StepHandlerMap,
  URDecoderLike,
} from "../machine/types";
import type {
  MintCatalogEntry,
  MintContactProfileResolver,
  MintReviewInfo,
  MintReviewsFetcher,
  WalletContext,
} from "../types";
import {
  createDefaultOperations,
  type DefaultOperationsConfig,
} from "../operations/defaultOperations";
import {
  createWalletContextTracker,
  type WalletContextTracker,
} from "./walletContextTracker";
import { createNostrMintEnrichment } from "../nostr-mint-enrichment";

// NUT-06 mint info as returned by coco's `Manager`. Re-derived here (rather than
// imported from cashu-ts) so the type tracks whatever shape `mgr.mint.getMintInfo`
// actually resolves to.
type MintInfo = Awaited<ReturnType<Manager["mint"]["getMintInfo"]>>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ColadaConfig {
  manager: Manager;

  /**
   * Persistence for transaction annotations (per-transaction side-data coco
   * does not store). Framework-agnostic; the wallet owns persistence +
   * profile-scoping. Read hooks fall back to an in-memory adapter when absent.
   */
  annotationStore?: AnnotationStoreAdapter;

  sendNostrDM?: (nprofile: string, message: string) => Promise<void>;

  /**
   * Onchain melt fee picker (NUT-30 fee_options). Called BEFORE prepare (no
   * proofs reserved while the user considers); resolve null to cancel.
   * Omitted -> the cheapest option is selected automatically.
   */
  selectOnchainFeeIndex?: DefaultOperationsConfig["selectOnchainFeeIndex"];

  /**
   * Sats per one minor unit of a fiat wallet unit (e.g. sats per usd-cent).
   * Required for fiat-unit melts to LNURL/onchain targets — see
   * DefaultOperationsConfig.getSatsPerUnitMinor.
   */
  getSatsPerUnitMinor?: DefaultOperationsConfig["getSatsPerUnitMinor"];

  /**
   * Extra LNURL invoice-callback query params (LUD-12 comment / NIP-57
   * zap request) — see DefaultOperationsConfig.getLnurlPayExtras.
   */
  getLnurlPayExtras?: DefaultOperationsConfig["getLnurlPayExtras"];

  unit?: string;
  /**
   * The wallet's ACTIVE unit (multi-unit wallets). The context tracker
   * serves balances/proof amounts/capabilities denominated in this unit so
   * machine-internal math never mixes units. Omit for sat-only wallets.
   */
  getActiveUnit?: () => string;
  getOffline?: () => boolean;
  getLocale?: () => string;
  getBtcPrice?: () => number;
  getDisplayCurrency?: () => { code: string; symbol: string } | null;
  enableEcashSendMemo?: boolean;

  getPreferredMintUrl?: () => string | undefined;

  /**
   * Bulk catalog fetcher. Awaited inside the mint-list build so audit / KYM /
   * operator-profile data flows directly into each row. One call per list
   * build, regardless of mint count.
   */
  fetchMintCatalog?: (
    mintUrls: string[],
  ) => Promise<Record<string, MintCatalogEntry>>;
  /**
   * Per-mint NUT-06 fetcher used by `buildMintListItems`. Lets the wallet route
   * through its own SWR cache + per-mint deadline so one slow/dead mint can't
   * gate the Select Mint screen. Defaults to coco's `manager.mint.getMintInfo`.
   */
  fetchMintInfo?: (mintUrl: string) => Promise<MintInfo | null>;
  /** Per-mint enrichment for the trust-review screen. Read from local caches. */
  enrichMintReviewInfo?: (mintUrl: string) => Partial<MintReviewInfo>;
  /**
   * Optional nagg REST app-view base URL (e.g. `https://nagg.example`). When
   * set, Colada can resolve mint contact profiles and mint reviews from the
   * indexed Nostr app-view without knowing which backend serves it.
   */
  nostrAppViewBaseUrl?: string;
  /** App-view route version prefix: `''` → `/nostr/*`, `'v1'` → `/v1/nostr/*`. Default `'v1'`. */
  nostrAppViewVersion?: "" | "v1";
  /** Resolve a mint operator Nostr pubkey from NUT-06 contact metadata. */
  resolveMintContactProfile?: MintContactProfileResolver;
  /** Fetch aggregated Nostr reviews for a mint. */
  fetchMintReviews?: MintReviewsFetcher;

  // Operation-level failure toggles. For transport-level faults (specific mint
  // error bodies, offline, timeouts per endpoint) prefer the app's e2e
  // mint-fault interceptor (sovran-app/app/shared/lib/e2e/mintFaults) — it
  // fakes the wire itself and needs no per-flow flag.
  /** Dev: when true, executePaymentRequest simulates a delivery failure to test rollback. */
  shouldMockFailPaymentRequest?: () => boolean;
  /** Dev: when true, executeMelt fails after prepare so the cancel-rescue path runs. */
  shouldMockFailMelt?: () => boolean;
  /** Dev: when true, executeSend fails before prepare. */
  shouldMockFailSend?: () => boolean;

  /**
   * Per-request timeout for external lightning calls (LNURL pay-params,
   * LNURL invoice callback). Defaults to 15 seconds. Tighter values give
   * the melt flow a faster fail-stop on hostile or stalled providers.
   */
  lightningTimeoutMs?: number;

  /**
   * Structured logger used by every internal module. Defaults to a no-op
   * so the package stays runtime-agnostic; sovran-app passes its scoped
   * `paymentLog` so colada events flow through the same
   * structured pipeline as the rest of the app.
   */
  logger?: CocoLogger;
}

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

export interface ColadaInstance {
  config: ColadaConfig;
  tracker: WalletContextTracker;
  getWalletContext: () => WalletContext;
  subscribeWalletContext: (listener: () => void) => () => void;
  operations: Partial<MachineOperations>;
  dispose: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createColada(config: ColadaConfig): ColadaInstance {
  const { manager, sendNostrDM, enrichMintReviewInfo } = config;

  if (config.logger) setLogger(config.logger);

  logger.info("core.createColada.start", {
    unit: config.unit ?? "sat",
    hasLogger: !!config.logger,
    hasOfflineGetter: !!config.getOffline,
    hasLocaleGetter: !!config.getLocale,
    hasBtcPriceGetter: !!config.getBtcPrice,
    hasDisplayCurrencyGetter: !!config.getDisplayCurrency,
    enableEcashSendMemo: config.enableEcashSendMemo === true,
    hasPreferredMintGetter: !!config.getPreferredMintUrl,
    hasFetchMintCatalog: !!config.fetchMintCatalog,
    hasFetchMintInfo: !!config.fetchMintInfo,
    hasEnrichMintReviewInfo: !!enrichMintReviewInfo,
    hasNostrAppViewBaseUrl: !!config.nostrAppViewBaseUrl,
    hasResolveMintContactProfile: !!config.resolveMintContactProfile,
    hasFetchMintReviews: !!config.fetchMintReviews,
    hasSendNostrDM: !!sendNostrDM,
    hasMockPaymentRequestFlag: !!config.shouldMockFailPaymentRequest,
    hasMockMeltFlag: !!config.shouldMockFailMelt,
    hasMockSendFlag: !!config.shouldMockFailSend,
    lightningTimeoutMs: config.lightningTimeoutMs ?? null,
  });

  const tracker = createWalletContextTracker(manager, {
    getPreferredMintUrl: config.getPreferredMintUrl,
    getActiveUnit: config.getActiveUnit,
  });

  const appViewEnrichment = config.nostrAppViewBaseUrl
    ? createNostrMintEnrichment({
        appViewBaseUrl: config.nostrAppViewBaseUrl,
        appViewVersion: config.nostrAppViewVersion,
      })
    : null;
  logger.info("core.createColada.enrichment", {
    appViewEnabled: !!appViewEnrichment,
    explicitContactResolver: !!config.resolveMintContactProfile,
    explicitReviewsFetcher: !!config.fetchMintReviews,
  });

  const operations = createDefaultOperations({
    getManager: () => manager,
    getProofAmounts: () => tracker.getContext().proofAmounts,
    getPreferredMintUrl: config.getPreferredMintUrl,
    sendNostrDM,
    enrichMintReviewInfo,
    fetchMintCatalog: config.fetchMintCatalog,
    fetchMintInfo: config.fetchMintInfo,
    resolveMintContactProfile:
      config.resolveMintContactProfile ??
      appViewEnrichment?.resolveMintContactProfile,
    fetchMintReviews:
      config.fetchMintReviews ?? appViewEnrichment?.fetchMintReviews,
    selectOnchainFeeIndex: config.selectOnchainFeeIndex,
    getSatsPerUnitMinor: config.getSatsPerUnitMinor,
    getLnurlPayExtras: config.getLnurlPayExtras,
    shouldMockFailPaymentRequest: config.shouldMockFailPaymentRequest,
    shouldMockFailMelt: config.shouldMockFailMelt,
    shouldMockFailSend: config.shouldMockFailSend,
    lightningTimeoutMs: config.lightningTimeoutMs,
  });
  logger.info("core.createColada.operations.ready", {
    operationCount: Object.keys(operations).length,
    hasExecuteReceive: !!operations.executeReceive,
    hasExecuteSend: !!operations.executeSend,
    hasExecuteOfflineSend: !!operations.executeOfflineSend,
    hasExecuteMintQuote: !!operations.executeMintQuote,
    hasExecuteMelt: !!operations.executeMelt,
    hasExecutePaymentRequest: !!operations.executePaymentRequest,
    hasExecuteNfcSend: !!operations.executeNfcSend,
  });

  return {
    config,
    tracker,
    getWalletContext: tracker.getContext,
    subscribeWalletContext: tracker.subscribe,
    operations,
    dispose: () => {
      logger.info("core.createColada.dispose");
      tracker.dispose();
    },
  };
}

export interface CreateMachineFromInstanceConfig {
  instance: ColadaInstance;
  handlers: StepHandlerMap;
  notifications?: NotificationHandlerMap;
  getOffline?: () => boolean;
  getLocale?: () => string;
  unit?: string;
  nfcAdapter?: NfcIOAdapter;
  scanSources?: ScanSources;
  createURDecoder?: () => URDecoderLike;
}

export function createMachineFromInstance(
  config: CreateMachineFromInstanceConfig,
): PaymentMachine {
  const {
    instance,
    handlers,
    notifications,
    getOffline,
    getLocale,
    unit = "sat",
    nfcAdapter,
    scanSources,
    createURDecoder,
  } = config;

  logger.info("core.createMachineFromInstance.start", {
    unit,
    handlerCount: Object.keys(handlers).length,
    notificationCount: Object.keys(notifications ?? {}).length,
    hasOfflineGetter: !!getOffline,
    hasLocaleGetter: !!getLocale,
    hasNfcAdapter: !!nfcAdapter,
    scanSourceCount: Object.keys(scanSources ?? {}).length,
    hasUrDecoder: !!createURDecoder,
    operationCount: Object.keys(instance.operations ?? {}).length,
  });

  const machine = createPaymentMachine({
    handlers,
    getContext: instance.tracker.getContext,
    getUnit: () => unit,
    getOffline: getOffline ?? (() => false),
    getSatsPerUnitMinor: instance.config.getSatsPerUnitMinor,
    getLocale: getLocale ?? (() => "en"),
    unit,
    operations: instance.operations as MachineOperations,
    enableEcashSendMemo: instance.config.enableEcashSendMemo,
    notifications,
    createURDecoder,
    scanSources,
    nfcAdapter,
  });

  logger.info("core.createMachineFromInstance.ready");
  return machine;
}
