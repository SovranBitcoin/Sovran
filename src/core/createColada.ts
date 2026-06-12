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
import type {
  MintCatalogEntry,
  MintContactProfileResolver,
  MintReviewInfo,
  MintReviewsFetcher,
  WalletContext,
} from '../types';
import { createDefaultOperations } from '../operations/defaultOperations';
import type { MeshTransportAdapter } from '../transport/types';
import { createWalletContextTracker, type WalletContextTracker } from './walletContextTracker';
import { createNostrGraphqlMintEnrichment } from '../nostr-graphql';

// NUT-06 mint info as returned by coco's `Manager`. Re-derived here (rather than
// imported from cashu-ts) so the type tracks whatever shape `mgr.mint.getMintInfo`
// actually resolves to.
type MintInfo = Awaited<ReturnType<Manager['mint']['getMintInfo']>>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ColadaConfig {
  manager: Manager;

  sendNostrDM?: (nprofile: string, message: string) => Promise<void>;

  /**
   * Mesh transport adapter for in-band NUT-18 payment requests (Nut Drop).
   * A getter because the adapter's lifetime tracks the mesh radio, not the
   * colada instance — return null while the mesh is down.
   */
  getMeshTransport?: () => MeshTransportAdapter | null;

  unit?: string;
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
  fetchMintCatalog?: (mintUrls: string[]) => Promise<Record<string, MintCatalogEntry>>;
  /**
   * Per-mint NUT-06 fetcher used by `buildMintListItems`. Lets the wallet route
   * through its own SWR cache + per-mint deadline so one slow/dead mint can't
   * gate the Select Mint screen. Defaults to coco's `manager.mint.getMintInfo`.
   */
  fetchMintInfo?: (mintUrl: string) => Promise<MintInfo | null>;
  /** Per-mint enrichment for the trust-review screen. Read from local caches. */
  enrichMintReviewInfo?: (mintUrl: string) => Partial<MintReviewInfo>;
  /**
   * Optional generic Nostr GraphQL endpoint. When set, Colada can resolve mint
   * contact profiles and mint reviews from indexed Nostr events without
   * knowing which backend serves the GraphQL schema.
   */
  nostrGraphqlEndpoint?: string;
  /** Resolve a mint operator Nostr pubkey from NUT-06 contact metadata. */
  resolveMintContactProfile?: MintContactProfileResolver;
  /** Fetch aggregated Nostr reviews for a mint. */
  fetchMintReviews?: MintReviewsFetcher;

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
  const {
    manager,
    sendNostrDM,
    enrichMintReviewInfo,
  } = config;

  if (config.logger) setLogger(config.logger);

  const tracker = createWalletContextTracker(manager, {
    getPreferredMintUrl: config.getPreferredMintUrl,
  });

  const graphqlEnrichment = config.nostrGraphqlEndpoint
    ? createNostrGraphqlMintEnrichment({ endpoint: config.nostrGraphqlEndpoint })
    : null;

  const operations = createDefaultOperations({
    getManager: () => manager,
    getProofAmounts: () => tracker.getContext().proofAmounts,
    getPreferredMintUrl: config.getPreferredMintUrl,
    sendNostrDM,
    getMeshTransport: config.getMeshTransport,
    enrichMintReviewInfo,
    fetchMintCatalog: config.fetchMintCatalog,
    fetchMintInfo: config.fetchMintInfo,
    resolveMintContactProfile:
      config.resolveMintContactProfile ?? graphqlEnrichment?.resolveMintContactProfile,
    fetchMintReviews: config.fetchMintReviews ?? graphqlEnrichment?.fetchMintReviews,
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
    getMeshTransport: instance.config.getMeshTransport,
    getLocale: getLocale ?? (() => 'en'),
    unit,
    operations: instance.operations as MachineOperations,
    enableEcashSendMemo: instance.config.enableEcashSendMemo,
    notifications,
    createURDecoder,
    scanSources,
    nfcAdapter,
  });
}
