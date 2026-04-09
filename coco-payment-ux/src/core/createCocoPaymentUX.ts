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
import type {
  MachineOperations,
  NfcIOAdapter,
  NotificationHandlerMap,
  PaymentMachine,
  ScanSources,
  StepHandlerMap,
  URDecoderLike,
} from '../machine/types';
import type { MintListItem, MintReviewInfo, WalletContext } from '../types';
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

  enrichMintListItem?: (mintUrl: string) => Partial<MintListItem>;
  enrichMintReviewInfo?: (mintUrl: string) => Partial<MintReviewInfo>;
  /** Fire-and-forget: populate profile data for mints with Nostr operator contacts. */
  fetchMintProfiles?: (mintInfoMap: Map<string, any>) => void;
  /** Fire-and-forget: populate audit data for mints during list build. */
  fetchMintAuditData?: (mintUrls: string[]) => void;
  /** Fire-and-forget: populate review/KYM data for mints during list build. */
  fetchMintReviewData?: (mintUrls: string[]) => void;

  /** Dev: when true, executePaymentRequest simulates a delivery failure to test rollback. */
  shouldMockFailPaymentRequest?: () => boolean;
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
    enrichMintListItem,
    enrichMintReviewInfo,
  } = config;

  const tracker = createWalletContextTracker(manager, {
    getPreferredMintUrl: config.getPreferredMintUrl,
  });

  const operations = createDefaultOperations({
    getManager: () => manager,
    getProofAmounts: () => tracker.getContext().proofAmounts,
    getPreferredMintUrl: config.getPreferredMintUrl,
    sendNostrDM,
    enrichMintListItem,
    enrichMintReviewInfo,
    fetchMintProfiles: config.fetchMintProfiles,
    fetchMintAuditData: config.fetchMintAuditData,
    fetchMintReviewData: config.fetchMintReviewData,
    shouldMockFailPaymentRequest: config.shouldMockFailPaymentRequest,
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
