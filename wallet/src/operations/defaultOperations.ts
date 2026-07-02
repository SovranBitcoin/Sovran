// ---------------------------------------------------------------------------
// Default Operations — backed by coco-cashu-core Manager
//
// Complete operations that use the Manager API + built-in LNURL resolution.
// Wallet apps get these out of the box and only need to provide what's
// app-specific: handlers (navigation), notifications (UI), and platform
// primitives.
//
// App-side operations (NOT included here, injected via enrichment callbacks):
//   linkTransaction       — needs app-specific scan history store
//   Mint catalog data     — bulk fetch (audit / KYM / operator profile),
//                           injected via fetchMintCatalog
//   Mint review detail    — local per-mint trust metrics injected via
//                           enrichMintReviewInfo; Nostr profile/review event
//                           enrichment can default to the nagg REST app-view via
//                           createColada({ nostrAppViewBaseUrl })
// ---------------------------------------------------------------------------

import {
  getTokenMetadata,
  type MeltQuoteOnchainFeeOption as OnchainMeltFeeOption,
} from "@cashu/cashu-ts";
import type {
  Manager,
  Mint,
  ReceiveHistoryEntry,
  SendHistoryEntry,
} from "@cashu/coco-core";
import { getEncodedToken } from "@cashu/coco-core";
import type { MachineOperations, StepDataMap } from "../machine/types";
import type {
  MintCatalogEntry,
  MintContactProfileResolver,
  MintListItem,
  MintReviewInfo,
  MintReviewsFetcher,
} from "../types";
import { defaultDetectors } from "../detectors";
import { errField, logger, mintUrlFields } from "../logger";
import { requestInvoiceFromLnurl, isLightningInvoiceBolt11 } from "../lnurl";
import { parsePaymentInput } from "../parse";
import { MeltUserCancelledError } from "../errors";
import { normalizeNostrPubkey, resolveRecipientPubkey } from "../recipient";
import { amountToNumber, type AmountLike } from "../amount";
import {
  buildMethodAwareMintCandidates,
  deriveMintMethodCapabilityMapFromTrustedMints,
} from "../mint-capabilities";
import { parseHistoryEntryOnce } from "./historyEntry";

// MintInfo is the cashu-ts GetInfoResponse — coco-core re-derives but does
// not export it as a named type, so we infer it from the manager API to
// stay aligned with whatever shape mgr.mint.getMintInfo actually returns.
type MintInfo = Awaited<ReturnType<Manager["mint"]["getMintInfo"]>>;
type CoreToken = NonNullable<SendHistoryEntry["token"]>;

function hasMintInfo(value: MintInfo | undefined): value is MintInfo {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value as Record<string, unknown>).length > 0
  );
}

function extractMintNostrContactPubkey(
  mintInfo: MintInfo | undefined,
): string | undefined {
  const contacts = (mintInfo as { contact?: unknown } | undefined)?.contact;
  if (!Array.isArray(contacts)) return undefined;
  for (const contact of contacts) {
    if (typeof contact !== "object" || contact === null) continue;
    const method = (contact as { method?: unknown }).method;
    const info = (contact as { info?: unknown }).info;
    if (typeof method !== "string" || typeof info !== "string") continue;
    if (method.trim().toLowerCase() !== "nostr") continue;
    const pubkey = normalizeNostrPubkey(info);
    if (pubkey) return pubkey;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// History lookup helpers
// ---------------------------------------------------------------------------

async function findSendHistoryEntryByOperationId(
  mgr: Manager,
  operationId: string,
): Promise<string | null> {
  logger.debug("operations.history.send.lookup.start", {
    operationId,
    limit: 50,
  });
  const history = await mgr.history.getPaginatedHistory(0, 50);
  const entry = history.find(
    (h): h is SendHistoryEntry =>
      h.type === "send" &&
      (h.operationId === operationId ||
        h.metadata?.operationId === operationId),
  );
  logger.debug("operations.history.send.lookup.done", {
    operationId,
    found: !!entry,
    historyCount: history.length,
    entryState: entry?.state ?? null,
  });
  return entry ? JSON.stringify(entry) : null;
}

function mapMeltOperationState(state: string): string {
  if (state === "finalized") return "PAID";
  if (state === "pending" || state === "executing") return "PENDING";
  return "UNPAID";
}

/**
 * Execute a prepared melt with the reservation rescue shared by every melt
 * rail: prepare() reserved proofs at the mint, so if execute() throws — mint
 * unreachable mid-flight, network drop, mint 5xx, or the QA mock-fail gate —
 * the operation is cancelled so the proofs don't stay locked until the next
 * manager restart. Safety-critical: keep ONE copy.
 */
async function executeMeltWithRescue(
  mgr: Manager,
  operation: { id: string },
  input: { mockFail: boolean; logPrefix: "executeMelt" | "executeMeltOnchain" },
): Promise<Awaited<ReturnType<Manager["ops"]["melt"]["execute"]>>> {
  const { logPrefix } = input;
  let result: Awaited<ReturnType<Manager["ops"]["melt"]["execute"]>>;
  try {
    // Mock-fail gate inside the try so the cancel-after-failure rescue runs —
    // exercising the same path the QA toggle exists to test.
    if (input.mockFail) {
      throw new Error("Mock melt failure (dev)");
    }
    result = await mgr.ops.melt.execute(operation.id);
  } catch (e) {
    logger.warn(`operations.${logPrefix}.executeFailed`, {
      operationId: operation.id,
      error: errField(e),
    });
    await mgr.ops.melt
      .cancel(operation.id, "Execute failed")
      .catch((cancelErr) => {
        logger.warn(`operations.${logPrefix}.cancelAfterFailureFailed`, {
          operationId: operation.id,
          error: errField(cancelErr),
        });
      });
    throw e;
  }
  logger.info(`operations.${logPrefix}.complete`, {
    operationId: result.id,
    state: result.state,
  });
  return result;
}

/** Serialized melt history entry shared by the bolt11 and onchain rails. */
function buildMeltEntry(
  result: Awaited<ReturnType<Manager["ops"]["melt"]["execute"]>>,
  unit: string,
  metadata: Record<string, string>,
): { historyEntry: string } {
  const entry = {
    id: result.id,
    type: "melt" as const,
    createdAt: result.createdAt,
    mintUrl: result.mintUrl,
    unit,
    quoteId: result.quoteId,
    state: mapMeltOperationState(result.state),
    amount: amountToNumber(result.amount),
    metadata: { operationId: result.id, ...metadata },
  };
  return { historyEntry: JSON.stringify(entry) };
}

/** Bare onchain address from a melt target (address or bitcoin:/BIP-321 URI). */
function extractOnchainAddress(meltTarget: string): string | null {
  const parsed = parsePaymentInput(meltTarget, defaultDetectors);
  const option = parsed?.options.find((o) => o.kind === "onchainAddress");
  return option?.value ?? null;
}

interface ExecuteOnchainMeltInput {
  mintUrl: string;
  address: string;
  amount: number;
  unit: string;
  selectFeeIndex?: (
    options: readonly OnchainMeltFeeOption[],
  ) => Promise<number | null>;
  mockFail: boolean;
}

/**
 * Onchain melt (coco v2, NUT-30): quote-first with the mint's fee options
 * surfaced to the user. The fee choice happens BEFORE ops.melt.prepare —
 * no proofs are reserved while the user considers, so dismissing the picker
 * cancels with nothing held (the orphaned canonical quote simply expires).
 * With no picker configured, the cheapest fee option is selected.
 */
async function executeOnchainMelt(
  mgr: Manager,
  input: ExecuteOnchainMeltInput,
): Promise<{ historyEntry: string }> {
  const { mintUrl, address, amount, unit } = input;
  logger.info("operations.executeMeltOnchain.start", {
    ...mintUrlFields(mintUrl),
    amount,
    unit,
    addressLength: address.length,
  });

  const quote = await mgr.quotes.melt.create({
    mintUrl,
    method: "onchain",
    methodData: { address, amountSats: amount },
    unit,
  });
  const feeOptions = quote.fee_options ?? [];
  logger.info("operations.executeMeltOnchain.quote_created", {
    ...mintUrlFields(mintUrl),
    quoteId: quote.quoteId,
    feeOptionCount: feeOptions.length,
  });
  if (feeOptions.length === 0) {
    throw new Error("Mint returned no onchain fee options");
  }

  let feeIndex: number | null;
  if (input.selectFeeIndex) {
    logger.info("operations.executeMeltOnchain.fee_options_shown", {
      optionCount: feeOptions.length,
    });
    feeIndex = await input.selectFeeIndex(feeOptions);
  } else {
    feeIndex = feeOptions.reduce((cheapest, option) =>
      amountToNumber(option.fee_reserve) < amountToNumber(cheapest.fee_reserve)
        ? option
        : cheapest,
    ).fee_index;
  }
  if (feeIndex == null) {
    logger.info("operations.executeMeltOnchain.fee_cancelled", {
      quoteId: quote.quoteId,
    });
    // No proofs were reserved yet — routing treats this as a quiet cancel.
    throw new MeltUserCancelledError("Onchain fee selection cancelled");
  }
  logger.info("operations.executeMeltOnchain.fee_selected", {
    feeIndex,
    optionCount: feeOptions.length,
  });

  const operation = await mgr.ops.melt.prepare({ quote, feeIndex });
  logger.info("operations.executeMeltOnchain.execute", {
    operationId: operation.id,
    quoteId: operation.quoteId,
  });

  const result = await executeMeltWithRescue(mgr, operation, {
    mockFail: input.mockFail,
    logPrefix: "executeMeltOnchain",
  });
  return buildMeltEntry(result, unit, {
    meltTarget: address,
    method: "onchain",
    onchainAddress: address,
  });
}

// ---------------------------------------------------------------------------
// Synthetic history-entry builders — used when coco's history row hasn't
// been persisted yet (race) or when we need to thread token data through
// the entry. Shapes mirror coco-core's history entries EXCEPT amounts:
// colada's JSON history contract carries plain numbers, so coco v2 Amount
// value objects are converted here (once, at the boundary) and never
// serialized — a raw Amount would JSON.stringify to a quoted string.
// ---------------------------------------------------------------------------

interface SendOperationLike {
  id: string;
  createdAt: number;
  updatedAt?: number;
  mintUrl: string;
  amount: AmountLike;
  unit?: string;
}

interface SyntheticSendEntry {
  id: string;
  type: "send";
  createdAt: number;
  mintUrl: string;
  unit: string;
  state: "pending";
  amount: number;
  operationId: string;
  token: CoreToken;
  metadata: { operationId: string };
}

/**
 * Send entry re-parsed from colada's JSON history contract — amounts are
 * serialized (number in synthetic entries; string when a coco v2 Amount was
 * stringified upstream), so this is deliberately NOT coco's SendHistoryEntry.
 */
interface ParsedSendEntry {
  id: string;
  type: "send";
  createdAt: number;
  mintUrl: string;
  unit: string;
  state: string;
  amount: number | string;
  operationId?: string;
  token?: CoreToken;
  metadata?: Record<string, unknown>;
}

function buildSyntheticSendEntry(
  operation: SendOperationLike,
  token: CoreToken,
): SyntheticSendEntry {
  return {
    id: operation.id,
    type: "send",
    createdAt: operation.createdAt,
    mintUrl: operation.mintUrl,
    unit: operation.unit ?? "sat",
    state: "pending",
    amount: amountToNumber(operation.amount),
    operationId: operation.id,
    token,
    metadata: { operationId: operation.id },
  };
}

function normalizeMemo(memo: string | undefined): string | undefined {
  const trimmed = memo?.trim();
  return trimmed ? trimmed : undefined;
}

function applyTokenMemo(token: CoreToken, memo: string | undefined): CoreToken {
  const normalized = normalizeMemo(memo);
  return normalized ? { ...token, memo: normalized } : token;
}

function ensureSendEntryToken(historyEntry: string, token: CoreToken): string {
  // The DB row may not have the token yet due to a race between execute
  // resolving and HistoryService persisting; inject it before returning so
  // the caller never sees a tokenless send entry.
  const parsed = parseHistoryEntryOnce(historyEntry);
  if (!parsed || parsed.type !== "send") return historyEntry;
  if (parsed.token)
    return JSON.stringify({ ...parsed, token: { ...parsed.token, ...token } });
  return JSON.stringify({ ...parsed, token });
}

function hasP2PKProofs(proofs: readonly { secret: string }[]): boolean {
  return proofs.some((proof) => {
    try {
      const parsed = JSON.parse(proof.secret);
      return Array.isArray(parsed) && parsed[0] === "P2PK";
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Payment request rollback helpers
// ---------------------------------------------------------------------------

async function attemptRollback(
  mgr: Manager,
  operationId: string,
): Promise<boolean> {
  try {
    const operation = await mgr.ops.send.get(operationId);
    if (operation && operation.state === "prepared") {
      logger.info("operations.attemptRollback.cancelPrepared", { operationId });
      await mgr.ops.send.cancel(operationId);
    } else if (
      operation &&
      ["executing", "pending"].includes(operation.state)
    ) {
      logger.info("operations.attemptRollback.reclaim", {
        state: operation.state,
        operationId,
      });
      await mgr.ops.send.reclaim(operationId);
    } else {
      logger.warn("operations.attemptRollback.unexpectedState", {
        state: operation?.state,
        operationId,
      });
      return false;
    }
    logger.info("operations.attemptRollback.success", { operationId });
    return true;
  } catch (e) {
    logger.warn("operations.attemptRollback.failed", {
      operationId,
      error: errField(e),
    });
    return false;
  }
}

function buildRolledBackResult(
  operationId: string,
  mintUrl: string,
  amount: number,
  unit: string,
  paymentRequest: string,
  transportType: "nostr" | "http" | "mesh",
  errorMessage: string,
): { historyEntry: string; rolledBack: true; errorMessage: string } {
  const entry = {
    id: operationId,
    type: "send" as const,
    createdAt: Date.now(),
    mintUrl,
    amount,
    unit,
    operationId,
    state: "rolledBack",
    metadata: {
      paymentRequest,
      phase: "rolledBack",
      tokenCreated: "true",
      transportType,
      errorMessage,
    },
  };
  logger.info("operations.executePaymentRequest.rolledBack", {
    operationId,
    errorMessage,
  });
  return {
    historyEntry: JSON.stringify(entry),
    rolledBack: true,
    errorMessage,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DefaultOperationsConfig {
  getManager: () => Manager | null;
  /**
   * Onchain melt fee picker (NUT-30 fee_options). Called BEFORE prepare (no
   * proofs reserved yet); resolve null to cancel. Omitted -> cheapest option.
   */
  selectOnchainFeeIndex?: (
    options: readonly OnchainMeltFeeOption[],
  ) => Promise<number | null>;
  getProofAmounts?: () => Record<string, number[]>;
  getPreferredMintUrl?: () => string | undefined;
  /** Required for Nostr payment request transport. Wallet supplies a NIP-17 publisher bound to the user's private key. */
  sendNostrDM?: (nprofile: string, message: string) => Promise<void>;
  /**
   * Bulk catalog fetcher for mint list items. Awaited inside `buildMintListItems`
   * before items are produced, so audit / KYM / operator-profile data flows
   * straight into each row instead of arriving later through cache subscriptions.
   *
   * The wallet implements this with whatever bulk API it has (e.g. a single
   * search-style endpoint that returns aggregates for every known mint). One
   * call per list build, not one per mint.
   *
   * Mints not present in the returned record render with no catalog data — the
   * row falls back to the mint URL / NUT-06 info already on screen.
   */
  fetchMintCatalog?: (
    mintUrls: string[],
  ) => Promise<Record<string, MintCatalogEntry>>;
  /**
   * Per-mint NUT-06 fetcher used by `buildMintListItems` to resolve name/icon.
   *
   * Defaults to `mgr.mint.getMintInfo`, which always hits coco's 5-min TTL and
   * exposes the list to coco's per-mint HTTP timeout — one slow/dead mint can
   * gate the Select Mint screen on every cold open. The wallet should inject a
   * cached + deadline-bounded fetcher so the list renders from last-known info
   * while the network refresh happens in the background. Returning `null` (or
   * throwing) yields the same `displayName: mintUrl` fallback as the direct
   * call would.
   */
  fetchMintInfo?: (mintUrl: string) => Promise<MintInfo | null>;
  /**
   * Optional per-mint enrichment for the trust-review screen. Synchronous,
   * read from local caches the wallet already populated (e.g. a screen that
   * needed the same audit data earlier in the session).
   */
  enrichMintReviewInfo?: (mintUrl: string) => Partial<MintReviewInfo>;
  /** Resolve a NUT-06 Nostr contact pubkey into display metadata. */
  resolveMintContactProfile?: MintContactProfileResolver;
  /** Fetch aggregated review rows for the trust-review screen. */
  fetchMintReviews?: MintReviewsFetcher;
  /**
   * Dev-only: when true, executePaymentRequest simulates a delivery failure
   * to test rollback. Ignored unless NODE_ENV !== 'production' so a hostile
   * config object in a release build cannot induce spurious delivery
   * failures.
   */
  shouldMockFailPaymentRequest?: () => boolean;
  /** Dev-only: when true, executeMelt throws after prepare so the cancel-rescue path runs. */
  shouldMockFailMelt?: () => boolean;
  /** Dev-only: when true, executeSend throws before prepare. */
  shouldMockFailSend?: () => boolean;
  /**
   * Per-request timeout for external lightning calls (LNURL pay-params,
   * LNURL invoice callback). Plumbed into `requestInvoiceFromLnurl` so a
   * stalled lightning-address provider cannot wedge the melt critical
   * path indefinitely. Defaults to the helper's own default (15s).
   */
  lightningTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDefaultOperations(
  config: DefaultOperationsConfig,
): Partial<MachineOperations> {
  const { getManager } = config;

  function requireManager(): Manager {
    const mgr = getManager();
    if (!mgr) {
      logger.warn("operations.requireManager.unavailable");
      throw new Error("Wallet manager is not available");
    }
    return mgr;
  }

  // Dev-only kill-switch for the failure-path tests. We do not trust the
  // `shouldMockFail*` getters in a release build: a misconfigured wallet (or
  // a hostile config object passed in via deep link / config hydration) could
  // otherwise force every send into the failure branch in production. Metro
  // and Bun both define `process.env.NODE_ENV`; we treat anything other than
  // 'production' as dev. `process` is read off `globalThis` so this compiles
  // in both the React Native (no @types/node) and Bun build contexts.
  const mockFailEnabled = (
    kind: "paymentRequest" | "melt" | "send",
  ): boolean => {
    const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
      .process;
    if (proc?.env?.NODE_ENV === "production") return false;
    const getter =
      kind === "paymentRequest"
        ? config.shouldMockFailPaymentRequest
        : kind === "melt"
          ? config.shouldMockFailMelt
          : config.shouldMockFailSend;
    return getter?.() === true;
  };

  return {
    executeSend: async (mintUrl, amount, memo, options) => {
      const mgr = requireManager();
      // send.execute is atomic — there is no rollback to exercise — so the
      // mock-fail gate runs before prepare to leave no reservation behind.
      if (mockFailEnabled("send")) {
        logger.warn("operations.executeSend.mockFailure", {
          ...mintUrlFields(mintUrl),
          amount,
        });
        throw new Error("Mock send failure (dev)");
      }
      const p2pkLockPubkey = options?.p2pkLockPubkey;
      logger.info("operations.executeSend.prepare", {
        ...mintUrlFields(mintUrl),
        amount,
        p2pkLocked: !!p2pkLockPubkey,
      });
      const prepared = await mgr.ops.send.prepare({
        mintUrl,
        amount,
        ...(p2pkLockPubkey
          ? { target: { type: "p2pk" as const, pubkey: p2pkLockPubkey } }
          : {}),
      });
      logger.info("operations.executeSend.prepared", {
        operationId: prepared.id,
        ...mintUrlFields(mintUrl),
        amount,
        needsSwap: !!prepared.needsSwap,
      });
      logger.info("operations.executeSend.execute", {
        operationId: prepared.id,
      });
      // v2 persists the memo on the executed token (whitespace-only ignored);
      // applyTokenMemo keeps the local copy consistent for synthetic entries.
      const { operation, token } = await mgr.ops.send.execute(prepared.id, {
        memo: normalizeMemo(memo),
      });
      const tokenWithMemo = applyTokenMemo(token, memo);
      logger.info("operations.executeSend.complete", {
        operationId: operation.id,
        state: operation.state,
        proofCount: token.proofs.length,
        hadMemo: !!normalizeMemo(memo),
      });

      // Try history first (should be there after execute), fall back to
      // constructing from the operation result to avoid a race.
      const historyEntry = await findSendHistoryEntryByOperationId(
        mgr,
        operation.id,
      );
      if (historyEntry) {
        logger.info("operations.executeSend.historyFound", {
          operationId: operation.id,
        });
        return {
          historyEntry: ensureSendEntryToken(historyEntry, tokenWithMemo),
        };
      }

      logger.warn("operations.executeSend.historyMissing", {
        operationId: operation.id,
      });
      return {
        historyEntry: JSON.stringify(
          buildSyntheticSendEntry(operation, tokenWithMemo),
        ),
      };
    },

    executeOfflineSend: async (mintUrl, amount, memo) => {
      const mgr = requireManager();
      logger.info("operations.executeOfflineSend.prepare", {
        ...mintUrlFields(mintUrl),
        amount,
        hadMemo: !!normalizeMemo(memo),
      });
      const prepared = await mgr.ops.send.prepare({ mintUrl, amount });
      logger.info("operations.executeOfflineSend.prepared", {
        operationId: prepared.id,
        ...mintUrlFields(mintUrl),
        amount,
        needsSwap: !!prepared.needsSwap,
      });

      if (prepared.needsSwap) {
        logger.warn("operations.executeOfflineSend.needsSwap", {
          operationId: prepared.id,
          ...mintUrlFields(mintUrl),
          amount,
        });
        await mgr.ops.send.cancel(prepared.id);
        logger.info("operations.executeOfflineSend.cancelledAfterNeedsSwap", {
          operationId: prepared.id,
        });
        throw new Error("Offline send requires exact proof match");
      }

      const { operation, token } = await mgr.ops.send.execute(prepared.id, {
        memo: normalizeMemo(memo),
      });
      const tokenWithMemo = applyTokenMemo(token, memo);
      logger.info("operations.executeOfflineSend.complete", {
        operationId: operation.id,
        state: operation.state,
        proofCount: token.proofs.length,
      });

      const historyEntry = await findSendHistoryEntryByOperationId(
        mgr,
        operation.id,
      );
      if (historyEntry) {
        logger.info("operations.executeOfflineSend.historyFound", {
          operationId: operation.id,
        });
        return {
          historyEntry: ensureSendEntryToken(historyEntry, tokenWithMemo),
        };
      }

      logger.warn("operations.executeOfflineSend.historyMissing", {
        operationId: operation.id,
      });
      return {
        historyEntry: JSON.stringify(
          buildSyntheticSendEntry(operation, tokenWithMemo),
        ),
      };
    },

    executeMintQuote: async (mintUrl, amount, _unit, method = "bolt11") => {
      const mgr = requireManager();
      const unit = _unit || "sat";
      logger.info("operations.executeMintQuote.prepare", {
        ...mintUrlFields(mintUrl),
        amount,
        method,
        unit,
      });

      // v2 quote-first: create the canonical quote row (remote quote happens
      // here), then prepare the durable mint operation against it. Onchain
      // quotes are reusable and get a FRESH address per create() — the
      // fixed-amount receive path relies on that for payment attribution.
      const quote =
        method === "onchain"
          ? await mgr.quotes.mint.create({ mintUrl, method: "onchain", unit })
          : await mgr.quotes.mint.create({
              mintUrl,
              method: "bolt11",
              amount: { amount, unit },
            });
      logger.info("operations.executeMintQuote.quoteCreated", {
        ...mintUrlFields(mintUrl),
        quoteId: quote.quoteId,
        method,
        unit: quote.unit,
        reusable: quote.reusable,
        requestLength: quote.request.length,
      });

      // Reusable (onchain) quotes derive nothing from the quote amount —
      // the operation amount must be explicit in v2.
      const mintOp = await mgr.ops.mint.prepare({ quote, amount });
      logger.info("operations.executeMintQuote.created", {
        operationId: mintOp.id,
        quoteId: mintOp.quoteId,
        method,
        state: quote.state ?? "UNPAID",
        unit: mintOp.unit,
      });

      // Build entry directly from the operation result to avoid a race
      // where getPaginatedHistory runs before HistoryService persists the
      // row. State uses the legacy quote-state family; the read-model
      // normalizer treats it interchangeably with v2 operation states.
      const entry = {
        id: mintOp.id,
        type: "mint" as const,
        operationId: mintOp.id,
        createdAt: mintOp.createdAt,
        mintUrl: mintOp.mintUrl,
        unit: mintOp.unit,
        quoteId: mintOp.quoteId,
        state: quote.state ?? ("UNPAID" as const),
        amount: amountToNumber(mintOp.amount),
        paymentRequest: quote.request,
        metadata: { operationId: mintOp.id },
      };
      return { historyEntry: JSON.stringify(entry) };
    },

    buildMintListItems: async (
      data: StepDataMap["selectMint"],
    ): Promise<MintListItem[]> => {
      const mgr = requireManager();
      const t0 = performance.now();
      logger.info("operations.buildMintListItems.start", {
        unit: data.unit,
        scope: data.scope,
        destination: data.destination,
      });
      const [allTrustedMints, balancesByMint] = await Promise.all([
        mgr.mint.getAllTrustedMints(),
        mgr.wallet.balances.byMint(),
      ]);
      const balances: Record<string, number> = Object.fromEntries(
        Object.entries(balancesByMint).map(([url, snap]) => [
          url,
          amountToNumber(snap.total),
        ]),
      );
      logger.info("operations.buildMintListItems.context.loaded", {
        trustedMintCount: allTrustedMints.length,
        balanceMintCount: Object.keys(balances).length,
        totalBalance: Object.values(balances).reduce(
          (sum, balance) => sum + balance,
          0,
        ),
      });

      // Seed from coco's local trusted-mint records first, then refresh via
      // getMintInfo. Offline or timed-out refreshes must not erase the
      // locally persisted name/icon/NUT metadata.
      // When the wallet injects `config.fetchMintInfo`, it can route through
      // its own SWR cache + per-mint deadline so a dead mint doesn't gate the
      // whole list.
      const fetchInfo =
        config.fetchMintInfo ?? ((url: string) => mgr.mint.getMintInfo(url));
      const mintInfoMap = new Map<string, MintInfo>();
      for (const mint of allTrustedMints) {
        if (hasMintInfo(mint.mintInfo)) {
          mintInfoMap.set(mint.mintUrl, mint.mintInfo);
        }
      }
      await Promise.all(
        allTrustedMints.map(async (mint) => {
          try {
            const info = await fetchInfo(mint.mintUrl);
            if (info) {
              mintInfoMap.set(mint.mintUrl, info);
              logger.info("operations.buildMintListItems.getMintInfo.ok", {
                ...mintUrlFields(mint.mintUrl),
                name: info.name,
                hasIcon: !!info.icon_url,
              });
            } else {
              logger.warn("operations.buildMintListItems.getMintInfo.null", {
                ...mintUrlFields(mint.mintUrl),
              });
            }
          } catch (e) {
            logger.warn("operations.buildMintListItems.getMintInfo.failed", {
              ...mintUrlFields(mint.mintUrl),
              error: errField(e),
            });
          }
        }),
      );
      logger.info("operations.buildMintListItems.info.resolved", {
        resolved: mintInfoMap.size,
        total: allTrustedMints.length,
        durationMs: Math.round(performance.now() - t0),
      });

      // One bulk fetch — the wallet returns audit / KYM / operator-profile
      // data for every trusted mint in a single round-trip. Awaited so items
      // ship to the screen with catalog fields already populated.
      const mintUrls = allTrustedMints.map((m) => m.mintUrl);
      let catalog: Record<string, MintCatalogEntry> = {};
      if (config.fetchMintCatalog) {
        try {
          logger.info("operations.buildMintListItems.fetchMintCatalog.start", {
            mintCount: mintUrls.length,
          });
          catalog = await config.fetchMintCatalog(mintUrls);
          logger.info("operations.buildMintListItems.fetchMintCatalog.done", {
            mintCount: mintUrls.length,
            returnedCount: Object.keys(catalog).length,
          });
        } catch (e) {
          logger.warn("operations.buildMintListItems.fetchMintCatalog.failed", {
            error: errField(e),
          });
        }
      }

      const supportedSet = data.supportedMintUrls
        ? new Set(data.supportedMintUrls)
        : null;
      const capabilityCtx = {
        trustedMintUrls: mintUrls,
        mintBalances: balances,
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(
          allTrustedMints.map((mint) => ({
            mintUrl: mint.mintUrl,
            mintInfo: mintInfoMap.get(mint.mintUrl) ?? mint.mintInfo,
          })),
          data.unit,
        ),
      };
      const methodCandidates = data.methodRequirement
        ? buildMethodAwareMintCandidates(
            capabilityCtx,
            data.methodRequirement,
            {
              amount: data.amount,
              allowedMints: data.supportedMintUrls,
              requireBalance:
                data.destination === "paymentRequest" ||
                data.destination === "meltQuote" ||
                data.destination === "sendEcash",
            },
          )
        : data.candidates;
      const candidateByMint = new Map(
        methodCandidates.map((candidate) => [candidate.mintUrl, candidate]),
      );

      const items = allTrustedMints.map((mint: Mint): MintListItem => {
        const mintUrl = mint.mintUrl;
        const info = mintInfoMap.get(mintUrl);
        const balance = balances[mintUrl] ?? 0;
        const candidate = candidateByMint.get(mintUrl);
        const isInCandidate = data.candidates.some(
          (c) => c.mintUrl === mintUrl,
        );

        let status: "available" | "disabled" = "available";
        let reason: MintListItem["reason"] = null;

        // Balance checks only apply in send-type flows (melt/send/payment request).
        // All other cases (no destination, mintQuote, scope override) allow every mint.
        const needsBalanceCheck =
          data.destination === "paymentRequest" ||
          data.destination === "meltQuote" ||
          data.destination === "sendEcash";
        const skipBalanceCheck =
          !needsBalanceCheck ||
          data.scope === "selected" ||
          data.scope === "npc";

        // NPC receive only works against mints that speak NUT-17 websockets:
        // the npub.cash plugin forwards paid quotes to the mint operation
        // service, which subscribes via the mint's websocket to know when the
        // quote settles. Mints without NUT-17 are shown for context but
        // disabled so the user can't pick one that won't auto-receive.
        const supportsWebsocket =
          (info?.nuts?.["17"]?.supported?.length ?? 0) > 0;
        if (data.scope === "npc" && !supportsWebsocket) {
          status = "disabled";
          reason = {
            code: "NO_WEBSOCKET",
            message: "Does not support live updates (NUT-17)",
          };
        } else if (supportedSet && !supportedSet.has(mintUrl)) {
          status = "disabled";
          reason = {
            code: "NOT_IN_PAYMENT_REQUEST",
            message: "Not accepted by payment request",
          };
        } else if (candidate?.status === "disabled") {
          status = "disabled";
          reason = candidate.reason ?? {
            code: "UNSUPPORTED_FOR_FLOW",
            message: "Unsupported for this flow",
          };
        } else if (!skipBalanceCheck && data.amount && balance < data.amount) {
          status = "disabled";
          reason = {
            code: "INSUFFICIENT_BALANCE",
            message: "Insufficient balance",
          };
        } else if (!skipBalanceCheck && !isInCandidate && balance <= 0) {
          status = "disabled";
          reason = { code: "NO_BALANCE", message: "No balance" };
        }

        const entry = catalog[mintUrl] ?? {};
        return {
          mintUrl,
          displayName: info?.name ?? mintUrl,
          iconUrl: info?.icon_url ?? undefined,
          balance,
          unit: data.unit,
          status,
          reason,
          isPreferred: false,
          kymScore: entry.kymScore,
          reviewCount: entry.reviewCount,
          auditScore: entry.auditScore,
          auditState: entry.auditState,
          auditTotalOps: entry.auditTotalOps,
          contactFollowers: entry.contactFollowers,
          contactReputation: entry.contactReputation,
        };
      });

      items.sort((a, b) => {
        if (a.status !== b.status) return a.status === "available" ? -1 : 1;
        return b.balance - a.balance;
      });
      const disabledReasons = items.reduce<Record<string, number>>(
        (acc, item) => {
          if (item.status !== "disabled") return acc;
          const code = item.reason?.code ?? "UNKNOWN";
          acc[code] = (acc[code] ?? 0) + 1;
          return acc;
        },
        {},
      );
      logger.info("operations.buildMintListItems.done", {
        total: items.length,
        available: items.filter((item) => item.status === "available").length,
        disabled: items.filter((item) => item.status === "disabled").length,
        disabledReasons,
        durationMs: Math.round(performance.now() - t0),
      });

      return items;
    },

    trustMint: async (mintUrl) => {
      const mgr = requireManager();
      logger.info("operations.trustMint", { ...mintUrlFields(mintUrl) });
      await mgr.mint.addMint(mintUrl, { trusted: true });
      logger.info("operations.trustMint.done", { ...mintUrlFields(mintUrl) });
    },

    executeNfcSend: async (mintUrl, amount) => {
      const mgr = requireManager();
      logger.info("operations.executeNfcSend.prepare", {
        ...mintUrlFields(mintUrl),
        amount,
      });
      const prepared = await mgr.ops.send.prepare({ mintUrl, amount });
      logger.info("operations.executeNfcSend.prepared", {
        operationId: prepared.id,
        needsSwap: !!prepared.needsSwap,
      });
      const { operation, token } = await mgr.ops.send.execute(prepared.id);
      logger.info("operations.executeNfcSend.tokenCreated", {
        operationId: operation.id,
        state: operation.state,
        proofCount: token.proofs.length,
      });
      const historyEntry = await findSendHistoryEntryByOperationId(
        mgr,
        operation.id,
      );
      if (!historyEntry) {
        logger.warn("operations.executeNfcSend.historyMissing", {
          operationId: operation.id,
          ...mintUrlFields(mintUrl),
          amount,
        });
        throw new Error("Send history entry not found after creation");
      }
      logger.info("operations.executeNfcSend.historyFound", {
        operationId: operation.id,
      });
      return {
        token: getEncodedToken(token),
        historyEntry,
        operationId: operation.id,
      };
    },

    rollbackSend: async (operationId) => {
      const mgr = getManager();
      if (!mgr) {
        logger.warn("operations.rollbackSend.noManager", { operationId });
        return;
      }
      logger.info("operations.rollbackSend.start", { operationId });
      const operation = await mgr.ops.send.get(operationId).catch((e) => {
        logger.warn("operations.rollbackSend.lookupFailed", {
          operationId,
          error: errField(e),
        });
        return null;
      });
      if (!operation) {
        logger.info("operations.rollbackSend.notFound", { operationId });
        return;
      }
      // Only swallow "already gone" — surface every other reclaim/cancel
      // failure so the caller can warn the user that the mint may still
      // hold the spent proofs in pending state. Silently telling the user
      // a send was cancelled when reclaim failed leaves wallet state and
      // mint state divergent.
      if (operation.state === "prepared") {
        logger.info("operations.rollbackSend.cancelPrepared", { operationId });
        await mgr.ops.send.cancel(operationId);
        logger.info("operations.rollbackSend.done", {
          operationId,
          action: "cancel",
        });
      } else if (["executing", "pending"].includes(operation.state)) {
        logger.info("operations.rollbackSend.reclaim", {
          state: operation.state,
          operationId,
        });
        await mgr.ops.send.reclaim(operationId);
        logger.info("operations.rollbackSend.done", {
          operationId,
          action: "reclaim",
        });
      } else {
        logger.info("operations.rollbackSend.noop", {
          operationId,
          state: operation.state,
        });
      }
    },

    // ── Screen action operations ────────────────────────────────────

    checkSendStatus: async (operationId) => {
      const mgr = requireManager();
      logger.info("operations.checkSendStatus.start", { operationId });
      const operation = await mgr.ops.send.get(operationId);
      if (!operation) {
        logger.info("operations.checkSendStatus.notFound", { operationId });
        return { state: "not_found" };
      }
      if (operation.state === "pending") {
        logger.info("operations.checkSendStatus.refresh", { operationId });
        await mgr.ops.send.refresh(operationId);
        const updated = await mgr.ops.send.get(operationId);
        logger.info("operations.checkSendStatus.done", {
          operationId,
          from: operation.state,
          to: updated?.state ?? operation.state,
        });
        return { state: updated?.state ?? operation.state };
      }
      logger.info("operations.checkSendStatus.done", {
        operationId,
        state: operation.state,
      });
      return { state: operation.state };
    },

    executeReceive: async (tokenString, mintUrl, _amount) => {
      const mgr = requireManager();
      logger.info("operations.executeReceive.start", {
        ...mintUrlFields(mintUrl),
        tokenLength: tokenString.length,
      });
      await mgr.wallet.receive(tokenString);
      logger.info("operations.executeReceive.received", {
        ...mintUrlFields(mintUrl),
      });

      let hadP2PK = false;
      let tokenAmount = 0;
      try {
        const metadata = getTokenMetadata(tokenString);
        hadP2PK = hasP2PKProofs(metadata.incompleteProofs);
        tokenAmount = amountToNumber(metadata.amount);
        logger.info("operations.executeReceive.tokenDecoded", {
          ...mintUrlFields(mintUrl),
          amount: tokenAmount,
          unit: metadata.unit ?? "sat",
          proofCount: metadata.incompleteProofs.length,
          hadP2PKProofs: hadP2PK,
        });
      } catch (e) {
        logger.warn("operations.executeReceive.p2pkDetectionFailed", {
          error: errField(e),
        });
      }

      // Try history first, fall back to constructing from known data
      // to avoid race where history write hasn't flushed yet.
      const historyEntry = await findReceiveHistoryEntry(
        mgr,
        tokenString,
        mintUrl,
      );
      if (historyEntry) {
        logger.info("operations.executeReceive.historyFound", {
          ...mintUrlFields(mintUrl),
          hadP2PKProofs: hadP2PK,
        });
        return { historyEntry, hadP2PKProofs: hadP2PK };
      }

      logger.warn("operations.executeReceive.historyMissing", {
        ...mintUrlFields(mintUrl),
      });
      // Synthetic fallback only — coco-core's history row is the canonical
      // store of the encoded token. Echoing it here would put a bearer
      // instrument into notifications.onTransactionCreated subscribers and
      // every entry-update listener that doesn't read from the DB.
      const entry = {
        id: `redeemed-${Date.now()}`,
        type: "receive" as const,
        createdAt: Date.now(),
        mintUrl,
        unit: "sat",
        amount: tokenAmount,
      };
      return { historyEntry: JSON.stringify(entry), hadP2PKProofs: hadP2PK };
    },

    isMintTrusted: async (mintUrl) => {
      const mgr = requireManager();
      const trusted = await mgr.mint.isTrustedMint(mintUrl);
      logger.info("operations.isMintTrusted.result", {
        ...mintUrlFields(mintUrl),
        trusted,
      });
      return trusted;
    },

    executeMelt: async (mintUrl, meltTarget, amount, _unit) => {
      const mgr = requireManager();
      const unit = _unit || "sat";

      // Onchain targets (bare address or bitcoin:/BIP-321 URI) take the
      // onchain melt path; everything else is Lightning (bolt11 or lnurl).
      const onchainAddress = extractOnchainAddress(meltTarget);
      if (onchainAddress) {
        return executeOnchainMelt(mgr, {
          mintUrl,
          address: onchainAddress,
          amount,
          unit,
          selectFeeIndex: config.selectOnchainFeeIndex,
          mockFail: mockFailEnabled("melt"),
        });
      }

      const targetKind = isLightningInvoiceBolt11(meltTarget)
        ? "bolt11"
        : "lnurl";
      logger.info("operations.executeMelt.start", {
        ...mintUrlFields(mintUrl),
        amount,
        unit,
        targetKind,
        targetLength: meltTarget.length,
      });

      const bolt11 =
        targetKind === "bolt11"
          ? meltTarget
          : await requestInvoiceFromLnurl(meltTarget, amount, {
              timeoutMs: config.lightningTimeoutMs,
            });
      logger.info("operations.executeMelt.invoiceReady", {
        ...mintUrlFields(mintUrl),
        amount,
        source: targetKind,
        invoiceLength: bolt11.length,
      });

      // v2 quote-first: canonical melt quote row, then the durable operation.
      const quote = await mgr.quotes.melt.create({
        mintUrl,
        method: "bolt11",
        methodData: { invoice: bolt11 },
        unit,
      });
      logger.info("operations.executeMelt.quoteCreated", {
        ...mintUrlFields(mintUrl),
        quoteId: quote.quoteId,
        unit,
      });
      const operation = await mgr.ops.melt.prepare({ quote });
      logger.info("operations.executeMelt.execute", {
        operationId: operation.id,
        quoteId: operation.quoteId,
      });
      const result = await executeMeltWithRescue(mgr, operation, {
        mockFail: mockFailEnabled("melt"),
        logPrefix: "executeMelt",
      });
      return buildMeltEntry(result, unit, { meltTarget });
    },

    rollbackMelt: async (operationId) => {
      const mgr = requireManager();
      logger.info("operations.rollbackMelt.start", { operationId });
      await mgr.ops.melt.cancel(operationId, "User cancelled");
      logger.info("operations.rollbackMelt.done", { operationId });
    },

    buildMintReviewInfo: async (mintUrl, item): Promise<MintReviewInfo> => {
      const mgr = requireManager();
      const t0 = performance.now();
      logger.info("operations.buildMintReviewInfo.start", {
        ...mintUrlFields(mintUrl),
        hasItem: !!item,
      });
      const [mintInfo, balancesByMint, isTrusted] = await Promise.all([
        mgr.mint.getMintInfo(mintUrl).catch((e) => {
          logger.warn("operations.buildMintReviewInfo.getMintInfo.failed", {
            ...mintUrlFields(mintUrl),
            error: errField(e),
          });
          return undefined;
        }),
        mgr.wallet.balances.byMint({ mintUrls: [mintUrl] }),
        mgr.mint.isTrustedMint(mintUrl),
      ]);

      const preferredMintUrl = config.getPreferredMintUrl?.();
      const enrichment = config.enrichMintReviewInfo?.(mintUrl) ?? {};
      logger.info("operations.buildMintReviewInfo.base.resolved", {
        ...mintUrlFields(mintUrl),
        hasMintInfo: !!mintInfo,
        isTrusted,
        hasPreferredMint: !!preferredMintUrl,
        enrichmentKeys: Object.keys(enrichment).length,
      });

      // The Select Mint row already carries fresh catalog data from
      // `fetchMintCatalog`; prefer it over `enrichMintReviewInfo`'s cache
      // read so audit/score travel with the navigation rather than relying
      // on a separately-warmed Zustand store.
      const rowCatalog: Partial<MintReviewInfo> = {};
      if (item) {
        if (item.kymScore !== undefined) rowCatalog.kymScore = item.kymScore;
        if (item.reviewCount !== undefined)
          rowCatalog.reviewCount = item.reviewCount;
        if (item.auditScore !== undefined)
          rowCatalog.auditScore = item.auditScore;
        if (item.auditState !== undefined)
          rowCatalog.auditState = item.auditState;
        if (item.contactFollowers !== undefined)
          rowCatalog.contactFollowers = item.contactFollowers;
        if (item.contactReputation !== undefined)
          rowCatalog.contactReputation = item.contactReputation;
      }

      // The selector row carries list-level aggregates from `fetchMintCatalog`
      // (kym/review counts, follower/reputation numbers) — NOT the full
      // recommendation list or the operator's kind-0 profile object. When the
      // specific aggregate a fetch would fill is already present we skip that
      // round-trip so the screen opens from context instead of blocking
      // navigation; the reviews screen fetches its own full list separately.
      //
      // Gate each skip on the EXACT field it backfills, and require ALL of a
      // group's fields — a partial row (e.g. a kym score without a review count,
      // or followers without reputation) must still fetch to fill the hole.
      const itemHasReviewAggregate = item?.reviewCount !== undefined;
      const itemHasContactProfile =
        item?.contactFollowers !== undefined &&
        item?.contactReputation !== undefined;

      const contactPubkey = extractMintNostrContactPubkey(mintInfo);
      const [contactProfile, reviews] = await Promise.all([
        contactPubkey &&
        config.resolveMintContactProfile &&
        !itemHasContactProfile
          ? config
              .resolveMintContactProfile(contactPubkey, mintUrl)
              .catch((e) => {
                logger.warn(
                  "operations.buildMintReviewInfo.contactProfile.failed",
                  {
                    ...mintUrlFields(mintUrl),
                    pubkey: contactPubkey,
                    error: errField(e),
                  },
                );
                return undefined;
              })
          : Promise.resolve(undefined),
        config.fetchMintReviews && !itemHasReviewAggregate
          ? config.fetchMintReviews(mintUrl).catch((e) => {
              logger.warn("operations.buildMintReviewInfo.reviews.failed", {
                ...mintUrlFields(mintUrl),
                error: errField(e),
              });
              return undefined;
            })
          : Promise.resolve(undefined),
      ]);

      const asyncEnrichment: Partial<MintReviewInfo> = {};
      if (contactProfile) {
        asyncEnrichment.contactProfile = contactProfile;
        if (typeof contactProfile.followers === "number") {
          asyncEnrichment.contactFollowers = contactProfile.followers;
        }
        if (typeof contactProfile.score === "number") {
          asyncEnrichment.contactReputation = Math.round(contactProfile.score);
        }
      }
      if (reviews) {
        asyncEnrichment.reviews = reviews;
        // Prefer the server's authoritative full-set count; fall back to the
        // returned page length only when the summary omitted it.
        asyncEnrichment.reviewCount =
          reviews.reviewCount ?? reviews.recommendations.length;
        if (typeof reviews.score === "number") {
          asyncEnrichment.kymScore = reviews.score;
        }
      }

      const result: MintReviewInfo = {
        mintUrl,
        displayName: mintInfo?.name ?? item?.displayName ?? mintUrl,
        iconUrl: mintInfo?.icon_url ?? item?.iconUrl,
        description: mintInfo?.description,
        longDescription: mintInfo?.description_long,
        motd: mintInfo?.motd,
        contact: mintInfo?.contact,
        nuts: mintInfo?.nuts
          ? Object.keys(mintInfo.nuts).map(Number)
          : undefined,
        balance: amountToNumber(
          balancesByMint[mintUrl]?.total ?? item?.balance ?? 0,
        ),
        unit: item?.unit ?? "sat",
        isPreferred: item?.isPreferred ?? mintUrl === preferredMintUrl,
        isTrusted,
        ...enrichment,
        ...rowCatalog,
        ...asyncEnrichment,
      };

      // Detail metrics (avgTimeMs, swap counts, totals) only exist in the
      // local cache; when the user came straight from the selector without a
      // warm cache, fall back to the success rate implied by auditScore so
      // the StatsGrid's headline number stays meaningful.
      if (
        result.successRate === undefined &&
        typeof result.auditScore === "number"
      ) {
        result.successRate = result.auditScore / 5;
      }
      logger.info("operations.buildMintReviewInfo.done", {
        ...mintUrlFields(mintUrl),
        balance: result.balance,
        isTrusted: result.isTrusted,
        hasContactProfile: !!contactProfile,
        reviewCount: result.reviewCount ?? 0,
        durationMs: Math.round(performance.now() - t0),
      });

      return result;
    },

    executePaymentRequest: async (mintUrl, paymentRequest, amount, unit) => {
      const mgr = requireManager();
      logger.info("operations.executePaymentRequest.start", {
        ...mintUrlFields(mintUrl),
        amount,
        unit,
        paymentRequestLength: paymentRequest.length,
      });

      const info = defaultDetectors.getPaymentRequestInfo(paymentRequest);
      if (!info) {
        logger.warn("operations.executePaymentRequest.parseFailed", {
          paymentRequestLength: paymentRequest.length,
        });
        throw new Error("Invalid payment request");
      }
      logger.info("operations.executePaymentRequest.parseDone", {
        ...mintUrlFields(mintUrl),
        requestedAmount: info.amount ?? null,
        transportCount: info.transports?.length ?? 0,
      });

      const nostrTransport = info.transports?.find((t) => t.type === "nostr");
      const httpTransport = info.transports?.find((t) => t.type === "post");
      let operationId: string;

      if (nostrTransport && !httpTransport) {
        logger.info("operations.executePaymentRequest.transport", {
          transport: "nostr",
        });
        // Nostr transport: use ops.send directly since PaymentRequestsApi doesn't support Nostr
        const sendNostrDM = config.sendNostrDM;
        if (!sendNostrDM) {
          logger.warn("operations.executePaymentRequest.nostrDM.unconfigured");
          throw new Error(
            "sendNostrDM operation is required for Nostr payment requests",
          );
        }

        const effectiveAmount = info.amount ?? amount;
        if (!effectiveAmount) {
          logger.warn("operations.executePaymentRequest.nostr.missingAmount");
          throw new Error("Amount is required for Nostr payment requests");
        }

        const prepared = await mgr.ops.send.prepare({
          mintUrl,
          amount: effectiveAmount,
        });
        logger.info("operations.executePaymentRequest.nostr.prepared", {
          operationId: prepared.id,
          ...mintUrlFields(mintUrl),
          amount: effectiveAmount,
          needsSwap: !!prepared.needsSwap,
        });
        const { operation, token } = await mgr.ops.send.execute(prepared.id);
        operationId = operation.id;
        logger.info("operations.executePaymentRequest.nostr.tokenCreated", {
          operationId,
          state: operation.state,
          proofCount: token.proofs.length,
        });

        const payload = {
          id: paymentRequest,
          mint: mintUrl,
          unit,
          proofs: token.proofs,
        };
        try {
          if (mockFailEnabled("paymentRequest")) {
            throw new Error("Mock delivery failure (dev)");
          }
          await sendNostrDM(nostrTransport.target, JSON.stringify(payload));
          logger.info("operations.executePaymentRequest.nostr.sent", {
            operationId,
          });
        } catch (deliveryErr) {
          logger.warn("operations.executePaymentRequest.nostr.deliveryFailed", {
            operationId,
            error: errField(deliveryErr),
          });
          const rollbackResult = await attemptRollback(mgr, operationId);
          if (rollbackResult) {
            const errorMessage =
              deliveryErr instanceof Error
                ? deliveryErr.message
                : "Nostr delivery failed";
            return buildRolledBackResult(
              operationId,
              mintUrl,
              effectiveAmount,
              unit,
              paymentRequest,
              "nostr",
              errorMessage,
            );
          }
          throw deliveryErr;
        }
      } else {
        logger.info("operations.executePaymentRequest.transport", {
          transport: "http",
        });
        // HTTP / transport-less payment request: use the paymentRequests API
        const parsed = await mgr.paymentRequests.parse(paymentRequest);
        logger.info("operations.executePaymentRequest.http.parsed", {
          ...mintUrlFields(mintUrl),
          amount,
          paymentRequestLength: paymentRequest.length,
        });
        const transaction = await mgr.paymentRequests.prepare(parsed, {
          mintUrl,
          amount,
        });
        operationId = transaction.sendOperation.id;
        logger.info("operations.executePaymentRequest.http.prepared", {
          operationId,
          ...mintUrlFields(mintUrl),
          amount,
        });
        try {
          if (mockFailEnabled("paymentRequest")) {
            throw new Error("Mock delivery failure (dev)");
          }
          await mgr.paymentRequests.execute(transaction);
          logger.info("operations.executePaymentRequest.http.executed", {
            operationId,
          });
        } catch (deliveryErr) {
          logger.warn("operations.executePaymentRequest.http.deliveryFailed", {
            operationId,
            error: errField(deliveryErr),
          });
          const rollbackResult = await attemptRollback(mgr, operationId);
          if (rollbackResult) {
            const errorMessage =
              deliveryErr instanceof Error
                ? deliveryErr.message
                : "HTTP delivery failed";
            return buildRolledBackResult(
              operationId,
              mintUrl,
              amount,
              unit,
              paymentRequest,
              "http",
              errorMessage,
            );
          }
          throw deliveryErr;
        }
      }

      const historyEntry = await findSendHistoryEntryByOperationId(
        mgr,
        operationId,
      );
      logger.info("operations.executePaymentRequest.historyLookup", {
        operationId,
        found: !!historyEntry,
      });
      const baseEntry: ParsedSendEntry = historyEntry
        ? // findSendHistoryEntryByOperationId only returns 'send' rows, so the
          // narrow is safe; the cast is a pragmatic alternative to re-running
          // the type guard inside parseHistoryEntryOnce's loose return.
          ((parseHistoryEntryOnce(historyEntry) as ParsedSendEntry | null) ??
          buildSyntheticPaymentRequestEntry(operationId, mintUrl, amount))
        : buildSyntheticPaymentRequestEntry(operationId, mintUrl, amount);
      // Enrich with transport metadata so the screen can show progress
      const enriched: ParsedSendEntry = {
        ...baseEntry,
        operationId: baseEntry.operationId ?? operationId,
        metadata: {
          ...(baseEntry.metadata ?? {}),
          paymentRequest,
          phase: "delivered",
          tokenCreated: "true",
          ...(nostrTransport
            ? { nostrSent: "true", transportType: "nostr" }
            : { transportType: "http" }),
        },
      };
      logger.info("operations.executePaymentRequest.done", {
        operationId,
        transport: nostrTransport ? "nostr" : "http",
      });
      return { historyEntry: JSON.stringify(enriched) };
    },

    // Background mesh auto-redeem: receives a token and resolves the REAL
    // persisted receive-history id by set difference (snapshot ids before,
    // poll after) — coco's history flush races the receive call, and a
    // synthesized id would break downstream linkage (location stamps,
    // scan-history links). Retires the wallet-side direct-coco exception.
    executeAutoRedeem: async (tokenString, mintUrl) => {
      const mgr = requireManager();

      let beforeIds = new Set<string>();
      try {
        const beforeHistory = await mgr.history.getPaginatedHistory(0, 100);
        beforeIds = new Set(
          beforeHistory
            .filter((h) => h.type === "receive" && h.mintUrl === mintUrl)
            .map((h) => h.id)
            .filter(
              (id): id is string => typeof id === "string" && id.length > 0,
            ),
        );
      } catch (e) {
        logger.warn("operations.executeAutoRedeem.snapshotFailed", {
          ...mintUrlFields(mintUrl),
          error: errField(e),
        });
      }

      logger.info("operations.executeAutoRedeem.start", {
        ...mintUrlFields(mintUrl),
        beforeCount: beforeIds.size,
        tokenLength: tokenString.length,
      });
      await mgr.wallet.receive(tokenString);
      logger.info("operations.executeAutoRedeem.received", {
        ...mintUrlFields(mintUrl),
      });

      // ~10s of polling at 200ms — waits out coco's history flush.
      const MAX_ATTEMPTS = 50;
      const DELAY_MS = 200;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const after = await mgr.history.getPaginatedHistory(0, 100);
          const newEntry = after.find(
            (h) =>
              h.type === "receive" &&
              h.mintUrl === mintUrl &&
              typeof h.id === "string" &&
              h.id.length > 0 &&
              !beforeIds.has(h.id),
          );
          if (newEntry) {
            logger.info("operations.executeAutoRedeem.found", {
              ...mintUrlFields(mintUrl),
              historyEntryId: newEntry.id,
              attempts: attempt + 1,
            });
            return {
              historyEntryId: newEntry.id,
              historyEntry: JSON.stringify(newEntry),
            };
          }
        } catch (e) {
          logger.warn("operations.executeAutoRedeem.pollFailed", {
            attempt,
            error: errField(e),
          });
        }
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }

      // The receive itself succeeded (proofs are persisted); only the
      // history linkage couldn't be resolved. Callers treat null as
      // "redeemed, unlinked" — loud log so the flush issue gets attention.
      logger.error("operations.executeAutoRedeem.timeoutFallback", {
        ...mintUrlFields(mintUrl),
        polledMs: MAX_ATTEMPTS * DELAY_MS,
      });
      return { historyEntryId: null, historyEntry: null };
    },

    // Lightning Address → Nostr hex pubkey via NIP-05. Best-effort. The
    // machine fires this automatically once `ctx.meltTarget` is set; if the
    // wallet supplies its own override (e.g. Tor-routed fetch) this default
    // is replaced. See `recipient.ts` for the implementation and failure
    // semantics — every error path returns `null`.
    resolveRecipientPubkey: async (meltTarget, signal) => {
      return resolveRecipientPubkey(meltTarget, { signal });
    },
  };
}

// ---------------------------------------------------------------------------
// Receive history lookup helper
// ---------------------------------------------------------------------------

function buildSyntheticPaymentRequestEntry(
  operationId: string,
  mintUrl: string,
  amount: number,
): Omit<SyntheticSendEntry, "token" | "metadata"> {
  const now = Date.now();
  return {
    id: operationId,
    type: "send",
    createdAt: now,
    mintUrl,
    unit: "sat",
    amount,
    operationId,
    state: "pending",
  };
}

async function findReceiveHistoryEntry(
  mgr: Manager,
  tokenString: string,
  mintUrl: string,
): Promise<string | null> {
  logger.debug("operations.history.receive.lookup.start", {
    ...mintUrlFields(mintUrl),
    tokenLength: tokenString.length,
    limit: 50,
  });
  const history = await mgr.history.getPaginatedHistory(0, 50);
  const entry = history.find(
    (h): h is ReceiveHistoryEntry =>
      h.type === "receive" &&
      h.mintUrl === mintUrl &&
      h.metadata?.rawToken === tokenString,
  );
  logger.debug("operations.history.receive.lookup.done", {
    ...mintUrlFields(mintUrl),
    found: !!entry,
    historyCount: history.length,
    entryState: entry?.state ?? null,
  });
  return entry ? JSON.stringify(entry) : null;
}
