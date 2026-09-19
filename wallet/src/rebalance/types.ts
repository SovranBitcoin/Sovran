import type { Amount } from '@cashu/coco-core';

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
}

/** The recipient side: a prepared bolt11 mint operation whose invoice the melt pays. */
export interface RebalanceMintReceipt {
  id: string;
  quoteId?: string;
  mintUrl: string;
  method: string;
  unit: string;
  amount: Amount;
  request: string;
}

/** A persisted recipient operation as coco reports it. */
export interface RebalanceMintSnapshot {
  id: string;
  quoteId?: string;
  mintUrl: string;
  method: string;
  unit: string;
  amount: Amount;
  state: string;
  error?: string;
}

type AmountValue = Amount | number | bigint | string | null | undefined;

/** The sender side: a prepared (not yet executed) melt operation. */
export interface RebalancePreparedMelt {
  id: string;
  quoteId?: string;
  amount?: AmountValue;
  fee_reserve?: AmountValue;
  swap_fee?: AmountValue;
}

/** A melt operation's persisted state. */
export interface RebalanceMeltSnapshot {
  id?: string;
  state?: string;
}

export interface StrandedMintBalance {
  url: string;
  balance: number;
}

/**
 * Wallet capabilities the engine drives. Each method is one Coco call (or one
 * existing recovery helper); the engine owns their sequencing.
 */
export interface RebalanceWalletPort {
  /** Spendable balance per mint URL, in the transfer unit. */
  balancesByMint(): Promise<Record<string, number>>;
  /** Input fee if every ready proof on the mint were spent. May throw; callers fall back. */
  worstCaseInputFee(mintUrl: string): Promise<number>;
  /** Fee reserve the mint quotes for paying `invoice` (read-only quote, nothing persisted). */
  probeMeltFeeReserve(mintUrl: string, invoice: string): Promise<number>;
  createMintReceipt(mintUrl: string, amount: number): Promise<RebalanceMintReceipt>;
  getMintOperation(operationId: string): Promise<RebalanceMintSnapshot | null>;
  prepareMelt(mintUrl: string, invoice: string): Promise<RebalancePreparedMelt>;
  executeMelt(operationId: string): Promise<RebalanceMeltSnapshot | undefined>;
  refreshMelt(operationId: string): Promise<RebalanceMeltSnapshot>;
  getMeltOperation(operationId: string): Promise<RebalanceMeltSnapshot | null>;
  /** Return proofs stuck `inflight` on the mint to ready. */
  restoreInflightProofs(mintUrl: string): Promise<void>;
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
  /** The melt was sent and its outcome is not yet known; coco recovers it later. */
  | 'paymentPending';

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
  mintReceiptCreated(legId: string, receipt: RebalanceMintReceipt): void;
  meltPrepared(legId: string, melt: RebalancePreparedMelt): void;
  /** A middleman route is about to run: create one leg per hop and return their ids in order. */
  routeAttemptStarted(
    stepId: string,
    attempt: RebalanceRouteAttempt
  ): { chainId: string; hopLegIds: string[] };
}

export type RebalanceTransferOutcome =
  | { status: 'done' }
  | { status: 'skipped' }
  /** Melt sent, settlement not confirmed in time. Never retried; coco reconciles it. */
  | { status: 'pending'; operationId: string }
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

export interface RebalanceRunCallbacks {
  isActive(): boolean;
  /** Already done or skipped in an earlier run. */
  isSettled(stepId: string): boolean;
  sinkFor(step: RebalanceTransfer): RebalanceEventSink;
  onTransferStart?(step: RebalanceTransfer): void;
  onTransferSettled?(step: RebalanceTransfer, outcome: RebalanceTransferOutcome): void;
}

export type RebalanceRunResult =
  | { status: 'aborted' }
  | { status: 'finished'; anyFailed: boolean; anyPending: boolean };
