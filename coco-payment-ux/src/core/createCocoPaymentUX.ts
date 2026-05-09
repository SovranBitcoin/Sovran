// ---------------------------------------------------------------------------
// createCocoPaymentUX — framework-agnostic factory
//
// Accepts a coco-cashu-core Manager and returns a fully operational instance
// with built-in operations, WalletContext tracking, and the PaymentMachine.
//
// This is the primary entry point for integrating coco-payment-ux. The wallet
// provides a Manager (from coco-cashu-core) and optional platform primitives;
// the instance does everything else.
// ---------------------------------------------------------------------------

import type { Manager } from '@cashu/coco-core';
import { createPaymentMachine } from '../machine/createMachine';
import { setLogger, type CocoLogger } from '../logger';
import type {
  MachineOperations,
  NfcIOAdapter,
  NotificationHandlerMap,
  PaymentMachine,
  ScanSources,
  StepHandlerMap,
  URDecoderLike,
} from '../machine/types';
import type { MintCatalogEntry, MintReviewInfo, WalletContext } from '../types';
import { createDefaultOperations } from '../operations/defaultOperations';
import { createWalletContextTracker, type WalletContextTracker } from './walletContextTracker';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CocoPaymentUXConfig {
  manager: Manager;

  platform?: {
    clipboard?: { write: (text: string) => Promise<void> };
    share?: (content: { message: string; url?: string }) => Promise<void>;
    nfc?: NfcIOAdapter;
    scanSources?: ScanSources;
    createURDecoder?: () => URDecoderLike;
  };

  sendNostrDM?: (nprofile: string, message: string) => Promise<void>;

  unit?: string;
  getOffline?: () => boolean;
  getLocale?: () => string;
  getBtcPrice?: () => number;
  getDisplayCurrency?: () => { code: string; symbol: string } | null;

  getPreferredMintUrl?: () => string | undefined;

  /**
   * Bulk catalog fetcher. Awaited inside the mint-list build so audit / KYM /
   * operator-profile data flows directly into each row. One call per list
   * build, regardless of mint count.
   */
  fetchMintCatalog?: (mintUrls: string[]) => Promise<Record<string, MintCatalogEntry>>;
  /** Per-mint enrichment for the trust-review screen. Read from local caches. */
  enrichMintReviewInfo?: (mintUrl: string) => Partial<MintReviewInfo>;

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
   * `paymentLog` so coco-payment-ux events flow through the same
   * structured pipeline as the rest of the app.
   */
  logger?: CocoLogger;
}

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

export interface CocoPaymentUXInstance {
  config: CocoPaymentUXConfig;
  tracker: WalletContextTracker;
  getWalletContext: () => WalletContext;
  subscribeWalletContext: (listener: () => void) => () => void;
  operations: Partial<MachineOperations>;
  dispose: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCocoPaymentUX(config: CocoPaymentUXConfig): CocoPaymentUXInstance {
  const {
    manager,
    platform,
    sendNostrDM,
    unit = 'sat',
    getOffline,
    getLocale,
    enrichMintReviewInfo,
  } = config;

  if (config.logger) setLogger(config.logger);

  const tracker = createWalletContextTracker(manager, {
    getPreferredMintUrl: config.getPreferredMintUrl,
  });

  const operations = createDefaultOperations({
    getManager: () => manager,
    getProofAmounts: () => tracker.getContext().proofAmounts,
    getPreferredMintUrl: config.getPreferredMintUrl,
    sendNostrDM,
    enrichMintReviewInfo,
    fetchMintCatalog: config.fetchMintCatalog,
    shouldMockFailPaymentRequest: config.shouldMockFailPaymentRequest,
    shouldMockFailMelt: config.shouldMockFailMelt,
    shouldMockFailSend: config.shouldMockFailSend,
    lightningTimeoutMs: config.lightningTimeoutMs,
  });

  return {
    config,
    tracker,
    getWalletContext: tracker.getContext,
    subscribeWalletContext: tracker.subscribe,
    operations,
    dispose: tracker.dispose,
  };
}

export interface CreateMachineFromInstanceConfig {
  instance: CocoPaymentUXInstance;
  handlers: StepHandlerMap;
  notifications?: NotificationHandlerMap;
  getOffline?: () => boolean;
  getLocale?: () => string;
  unit?: string;
  nfcAdapter?: NfcIOAdapter;
  scanSources?: ScanSources;
  createURDecoder?: () => URDecoderLike;
}

export function createMachineFromInstance(config: CreateMachineFromInstanceConfig): PaymentMachine {
  const {
    instance,
    handlers,
    notifications,
    getOffline,
    getLocale,
    unit = 'sat',
    nfcAdapter,
    scanSources,
    createURDecoder,
  } = config;

  return createPaymentMachine({
    handlers,
    getContext: instance.tracker.getContext,
    getUnit: () => unit,
    getOffline: getOffline ?? (() => false),
    getLocale: getLocale ?? (() => 'en'),
    unit,
    operations: instance.operations as MachineOperations,
    notifications,
    createURDecoder,
    scanSources,
    nfcAdapter,
  });
}
