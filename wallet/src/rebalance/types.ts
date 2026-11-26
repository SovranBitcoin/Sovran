import type { Manager, MintSwapOperation } from '@cashu/coco-core';

import type { CocoLogger } from '../logger';

/** One transfer of `amount` from one mint to another (a plan step or a middleman hop). */
export interface RebalanceTransfer {
  id: string;
  fromMintUrl: string;
  toMintUrl: string;
  amount: number;
  chainId?: string;
  chainPath?: string[];
  chainHopIndex?: number;
  /**
   * One leg only: a source payment rejection fails this transfer instead of
   * being sent through middleman mints. The caller routes.
   */
  directOnly?: boolean;
  /**
   * Most the source may be debited, in sats: the destination amount plus fees.
   * Passed directly to Coco's `ops.mintSwap.prepare({ sourceDebitCap })`.
   */
  sourceDebitCap?: number;
  /**
   * Deliver exactly `amount` or nothing: where the source balance, fees or
   * proof selection would lower it, the transfer fails before anything is
   * paid instead of moving less.
   */
  exactAmount?: boolean;
}

export interface StrandedMintBalance {
  url: string;
  balance: number;
}

/** The Coco `manager.ops.mintSwap` surface that the rebalance engine drives. */
export type RebalanceMintSwapApi = Pick<
  Manager['ops']['mintSwap'],
  'prepare' | 'execute' | 'get' | 'listActive' | 'refresh' | 'cancel' | 'waitForOutcome'
>;

/**
 * Wallet capabilities the rebalance engine drives. Single-hop swap execution,
 * settlement, proof reservation and recovery belong to Coco's `ops.mintSwap`.
 */
export interface RebalanceWalletPort {
  /** Spendable balance per mint URL, in the transfer unit. */
  balancesByMint(): Promise<Record<string, number>>;
  /** Input fee if every ready proof on the mint were spent. May throw; callers fall back. */
  worstCaseInputFee(mintUrl: string): Promise<number>;
  /** Coco's native single-hop mint-to-mint swap API. */
  mintSwap: RebalanceMintSwapApi;
  trustMint(mintUrl: string): Promise<void>;
  /** Untrust every URL; report those still holding a balance. */
  releaseTrust(mintUrls: readonly string[]): Promise<{
    stranded: StrandedMintBalance[];
    untrustErrors: { url: string; error: unknown }[];
  }>;
}

export interface RebalanceRoute {
  /** Ordered mint URLs, source first, destination last. */
  path: string[];
  pathNames: string[];
  source: 'graph' | 'local_history';
}

export type RebalanceLegStatus =
  | 'creatingInvoice'
  | 'invoiceReady'
  | 'melting'
  | 'routing'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'skipped'
  /** The source payment was sent and its outcome is not yet known; coco recovers it later. */
  | 'paymentPending'
  /** The source paid; the destination mint had not issued within the wait. */
  | 'settling';

/** Structured routing context; the UI formats it for display. */
export type RebalanceRoutingInfo =
  | { kind: 'searching' }
  | { kind: 'candidate'; index: number; count: number; path: string[]; pathNames: string[] }
  | { kind: 'hop'; hopIndex: number; hopCount: number; fromMintUrl: string; toMintUrl: string }
  | { kind: 'stranded'; stranded: StrandedMintBalance[] };

export interface RebalanceLegUpdate {
  status?: RebalanceLegStatus;
  invoice?: string;
  operationId?: string;
  /** The failure, kept structured; `null` clears a previous one. */
  error?: unknown;
  /** `null` clears the routing context. */
  routing?: RebalanceRoutingInfo | null;
}

export interface RebalanceLegDescriptor {
  fromMintUrl: string;
  toMintUrl: string;
  amount: number;
  chainId?: string;
  chainPath?: string[];
  chainHopIndex?: number;
}

export interface RebalanceRouteAttempt {
  route: RebalanceRoute;
  index: number;
  count: number;
}

/** Where the engine reports progress. Legs are the plan step and any hop rows. */
export interface RebalanceEventSink {
  /** A leg is committed to run with this amount (persist it for history). */
  legOpened(legId: string, leg: RebalanceLegDescriptor): void;
  legUpdated(legId: string, update: RebalanceLegUpdate): void;
  /** Coco prepared the mint swap; carries parent + child quote/operation ids for history. */
  swapPrepared(legId: string, operation: MintSwapOperation): void;
  /** A middleman route is about to run: create one leg per hop and return their ids in order. */
  routeAttemptStarted(
    stepId: string,
    attempt: RebalanceRouteAttempt
  ): { chainId: string; hopLegIds: string[] };
}

export type RebalanceTransferOutcome =
  | { status: 'done' }
  | { status: 'skipped' }
  /** Source payment sent, settlement not confirmed in time. Never retried; coco reconciles it. */
  | { status: 'pending'; operationId: string }
  /**
   * The source settled, so the money has left the source mint, but the destination
   * had not issued within the wait. Never retried; coco's mintSwap processor claims it.
   */
  | { status: 'settling' }
  | { status: 'failed'; error: unknown }
  /** Run cancelled or superseded; nothing further was published. */
  | { status: 'aborted' }
  /** Another transfer held the execution lock past its deadline. */
  | { status: 'busy' };

export interface RebalanceClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface RebalanceLock {
  acquire(maxWaitMs?: number): Promise<boolean>;
  release(): void;
}

export interface RebalanceEngineConfig {
  wallet: RebalanceWalletPort;
  /** Candidate middleman routes for a no-route failure, best first. */
  findRoutes(fromMintUrl: string, toMintUrl: string): Promise<RebalanceRoute[]>;
  trustedMintUrls: ReadonlySet<string>;
  minTransferThreshold: number;
  /** Planning floor for the Lightning fee reserve, in sats. */
  minFeeReserve: number;
  /** Shared across engine instances of one screen so transfers never overlap. */
  lock: RebalanceLock;
  clock?: RebalanceClock;
  logger?: CocoLogger;
}

/**
 * Whether a run is still wanted. `isActive` is asked throughout, also while a
 * leg is in flight; `beforeLegOpens` only before a new leg opens, before
 * anything is sent for it. A caller that ends the run there (so `isActive`
 * reads false from then on) stops it before that leg, without stopping one
 * already in flight.
 */
export interface RebalanceRunActivity {
  isActive(): boolean;
  beforeLegOpens?(): void;
}

export interface RebalanceRunCallbacks extends RebalanceRunActivity {
  /** Already done or skipped in an earlier run. */
  isSettled(stepId: string): boolean;
  sinkFor(step: RebalanceTransfer): RebalanceEventSink;
  onTransferStart?(step: RebalanceTransfer): void;
  onTransferSettled?(step: RebalanceTransfer, outcome: RebalanceTransferOutcome): void;
}

export type RebalanceRunResult =
  | { status: 'aborted' }
  | { status: 'finished'; anyFailed: boolean; anyPending: boolean };
