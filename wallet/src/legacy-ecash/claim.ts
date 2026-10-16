import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { logger } from "../logger";
import type { LegacyEcashGroup, LegacyEcashRead, LegacyMintQuote, LegacyProof } from "./reader";
import type {
  LegacyClaimErrorClass,
  LegacyEcashRecords,
  LegacyGroupRecord,
  LegacyQuoteRecord,
} from "./records";

/**
 * Brings the ecash of the redux-era row into the open wallet.
 *
 * These are bearer proofs: whoever presents them to the mint first owns the
 * value. So the seed the old app derived them from does not matter. The mint
 * is asked which proofs are still unspent (NUT-07), and those are handed to
 * the wallet's own receive, which swaps them for new proofs it derives itself.
 *
 * One group is one old profile's proofs for one keyset at one mint:
 *
 *   open ──► settled            every proof is in the wallet or spent
 *        ──► awaiting-trust     unspent, but the wallet does not trust the mint
 *        ──► could-not-claim    the mint refused for good, or five attempts failed
 *   awaiting-trust ──► open     the person trusted the mint
 *                  ──► left-unclaimed   the person declined
 *   left-unclaimed ──► open     the person trusted the mint later
 *
 * `settled` and `could-not-claim` are final. Nothing is retried for ever.
 *
 * Before any of that, a group's proofs are compared with account 0's wallet,
 * whichever account they belong in: releases 0.0.45 to 0.0.56 imported every
 * old profile into that one wallet without swapping. Proofs found there are
 * finished with, and only the rest is claimed into the group's own account.
 */

export type LegacyProofState = "UNSPENT" | "SPENT" | "PENDING";
export type LegacyReceiveState = "prepared" | "executing" | "finalized" | "rolled-back" | "missing";
/**
 * What the mint said about an old invoice. `unknown-quote` is only for an
 * answer that says, in so many words, that the mint has no such quote.
 */
export interface LegacyMintQuoteAnswer {
  state: "unpaid" | "paid" | "issued" | "unknown-quote";
  /** When the invoice stops being payable, in Unix seconds, if the mint says. */
  expirySec: number | null;
}

/** The run's wallet is no longer the open one. Nothing more may be written. */
class LegacyClaimStopped extends Error {}

/** A failure whose class is already known to the code that raised it. */
export class LegacyClaimFault extends Error {
  constructor(
    readonly errorClass: LegacyClaimErrorClass,
    options?: { cause?: unknown }
  ) {
    super(`legacy ecash claim: ${errorClass}`, options);
    this.name = "LegacyClaimFault";
  }
}

export interface LegacyClaimPorts {
  nowMs: number;
  /** The account whose wallet is open. Only its groups are worked on. */
  accountIndex: number;
  /** Every account on this phone. A removed account's wallet database is gone. */
  accounts: readonly number[];
  /** The account a group belongs in. Always one of `accounts`. */
  targetAccount(group: LegacyEcashGroup): number;
  /** False once the wallet this run started with is no longer the open one. */
  isLive(): boolean;
  records: {
    read(): LegacyEcashRecords;
    /** Resolves once the record is on disk. */
    writeGroup(id: string, record: LegacyGroupRecord): Promise<void>;
    writeQuote(id: string, record: LegacyQuoteRecord): Promise<void>;
  };
  mint: {
    /** One state per proof, in order. Rejects when the mint does not answer. */
    checkStates(mintUrl: string, proofs: LegacyProof[]): Promise<LegacyProofState[]>;
    /** keyset id -> unit, as the mint lists them today. */
    keysetUnits(mintUrl: string): Promise<Map<string, string>>;
    quoteState(mintUrl: string, mintQuoteId: string): Promise<LegacyMintQuoteAnswer>;
  };
  wallet: {
    isTrusted(mintUrl: string): Promise<boolean>;
    /** The secrets among these that the open wallet already stores. */
    heldSecrets(mintUrl: string, proofSecrets: string[]): Promise<Set<string>>;
    /** Records a receive without contacting the mint. */
    prepareReceive(mintUrl: string, unit: string, proofs: LegacyProof[]): Promise<string>;
    executeReceive(operationId: string): Promise<void>;
    /** The wallet's own record of a receive, after its crash recovery has looked at it. */
    receiveState(operationId: string): Promise<LegacyReceiveState>;
    cancelReceive(operationId: string): Promise<void>;
  };
}

/** Attempts on one group or quote before it is left alone. */
const LEGACY_CLAIM_MAX_ATTEMPTS = 5;
const HOUR_MS = 60 * 60 * 1000;
/** The wait after the first, second, third and fourth failed attempt. */
const RETRY_DELAYS_MS = [HOUR_MS, 24 * HOUR_MS, 3 * 24 * HOUR_MS, 7 * 24 * HOUR_MS];
/** Proofs per receive, so one swap stays inside the mint's input limit. */
const CLAIM_BATCH_SIZE = 100;

const FINAL_ERROR_CLASSES: ReadonlySet<LegacyClaimErrorClass> = new Set([
  "keyset-unknown",
  "proofs-rejected",
  "wallet-refused",
]);

/**
 * The one place a failure is turned into a class. Mint error codes are the
 * NUT error codes as nutshell and cdk send them; anything without a code is
 * a failure to get an answer.
 */
function classifyLegacyClaimError(error: unknown): LegacyClaimErrorClass {
  if (error instanceof LegacyClaimFault) return error.errorClass;
  const code: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "code") : null;
  if (typeof code !== "number") return "transient";
  if (code === 11001) return "spent-during-claim";
  if (code === 11002 || code === 11004) return "pending";
  if (code === 12001) return "keyset-unknown";
  if (code === 10001 || code === 10003) return "proofs-rejected";
  return "transient";
}

function legacyProofFingerprint(proofSecret: string): string {
  return bytesToHex(sha256(utf8ToBytes(proofSecret))).slice(0, 32);
}

function legacyQuoteRecordId(quote: Pick<LegacyMintQuote, "mintUrl" | "mintQuoteId">): string {
  return bytesToHex(sha256(utf8ToBytes(`${quote.mintUrl}\n${quote.mintQuoteId}`))).slice(0, 32);
}

function sumAmounts(proofs: LegacyProof[]): number {
  return proofs.reduce((total, proof) => total + proof.amount, 0);
}

/**
 * The same ports, with the liveness check built in: it runs after every wait
 * and before every write, so a run whose wallet was closed or whose storage
 * was wiped stops where it is and leaves nothing behind.
 */
function stopWhenNotLive(ports: LegacyClaimPorts): LegacyClaimPorts {
  const assertLive = () => {
    if (!ports.isLive()) throw new LegacyClaimStopped();
  };
  const settled = async <T>(work: Promise<T>): Promise<T> => {
    try {
      return await work;
    } finally {
      assertLive();
    }
  };
  const { records, mint, wallet } = ports;
  return {
    ...ports,
    records: {
      read: () => records.read(),
      writeGroup: (id, record) => {
        assertLive();
        return settled(records.writeGroup(id, record));
      },
      writeQuote: (id, record) => {
        assertLive();
        return settled(records.writeQuote(id, record));
      },
    },
    mint: {
      checkStates: (mintUrl, proofs) => settled(mint.checkStates(mintUrl, proofs)),
      keysetUnits: (mintUrl) => settled(mint.keysetUnits(mintUrl)),
      quoteState: (mintUrl, mintQuoteId) => settled(mint.quoteState(mintUrl, mintQuoteId)),
    },
    wallet: {
      isTrusted: (mintUrl) => settled(wallet.isTrusted(mintUrl)),
      heldSecrets: (mintUrl, proofSecrets) => settled(wallet.heldSecrets(mintUrl, proofSecrets)),
      prepareReceive: (mintUrl, unit, proofs) => settled(wallet.prepareReceive(mintUrl, unit, proofs)),
      executeReceive: (operationId) => {
        assertLive();
        return settled(wallet.executeReceive(operationId));
      },
      receiveState: (operationId) => settled(wallet.receiveState(operationId)),
      cancelReceive: (operationId) => settled(wallet.cancelReceive(operationId)),
    },
  };
}

function freshRecord(group: LegacyEcashGroup, accountIndex: number): LegacyGroupRecord {
  return {
    mintUrl: group.mintUrl,
    keysetId: group.keysetId,
    profileIndex: group.profileIndex,
    accountIndex,
    unit: group.unit,
    status: "open",
    claimed: 0,
    spent: 0,
    inWallet: 0,
    failed: 0,
    awaiting: 0,
    firstAccountComparison: "pending",
    done: [],
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    claiming: null,
    updatedAt: 0,
  };
}

/** The proofs of a group that no earlier run finished with. */
function remainingProofs(group: LegacyEcashGroup, record: LegacyGroupRecord): LegacyProof[] {
  const done = new Set(record.done);
  return group.proofs.filter((proof) => !done.has(legacyProofFingerprint(proof.secret)));
}

interface GroupRun {
  group: LegacyEcashGroup;
  record: LegacyGroupRecord;
  ports: LegacyClaimPorts;
}

async function save(run: GroupRun, patch: Partial<LegacyGroupRecord>): Promise<void> {
  run.record = { ...run.record, ...patch, updatedAt: run.ports.nowMs };
  await run.ports.records.writeGroup(run.group.id, run.record);
}

/** Moves proofs to "finished with" and adds their value to one tally, in one write. */
async function finish(
  run: GroupRun,
  proofs: LegacyProof[],
  tally: "claimed" | "spent" | "inWallet" | "failed",
  extra: Partial<LegacyGroupRecord> = {}
): Promise<void> {
  if (proofs.length === 0 && Object.keys(extra).length === 0) return;
  await save(run, {
    done: [...run.record.done, ...proofs.map((proof) => legacyProofFingerprint(proof.secret))],
    [tally]: run.record[tally] + sumAmounts(proofs),
    ...extra,
  });
}

/**
 * A receive was recorded as sent and the app stopped before recording its
 * result. The wallet's own operation record says what happened, so the value
 * is counted once whether or not the swap went through.
 */
async function settleInterruptedClaim(run: GroupRun): Promise<void> {
  const claiming = run.record.claiming;
  if (!claiming) return;
  const state = await run.ports.wallet.receiveState(claiming.operationId);
  if (state === "executing") throw new LegacyClaimFault("claim-in-flight");
  if (state === "finalized") {
    await save(run, {
      done: [...run.record.done, ...claiming.proofs],
      claimed: run.record.claimed + claiming.amount,
      claiming: null,
    });
    return;
  }
  // Never sent, or the mint refused it: the proofs are asked about again below.
  if (state === "prepared") await run.ports.wallet.cancelReceive(claiming.operationId);
  await save(run, { claiming: null });
}

async function claimBatch(run: GroupRun, unit: string, batch: LegacyProof[]): Promise<void> {
  const { wallet } = run.ports;
  const operationId = await wallet.prepareReceive(run.group.mintUrl, unit, batch);
  await save(run, {
    claiming: {
      operationId,
      accountIndex: run.ports.accountIndex,
      proofs: batch.map((proof) => legacyProofFingerprint(proof.secret)),
      amount: sumAmounts(batch),
    },
  });
  try {
    await wallet.executeReceive(operationId);
  } catch (error) {
    // The request may have reached the mint. The wallet's record decides.
    const state = await wallet.receiveState(operationId).catch(() => "executing" as const);
    if (state === "executing") throw new LegacyClaimFault("claim-in-flight", { cause: error });
    if (state !== "finalized") {
      await save(run, { claiming: null });
      throw error;
    }
  }
  await finish(run, batch, "claimed", { claiming: null });
}

/**
 * Releases 0.0.45 to 0.1.1 copied old proofs into the wallet as they were.
 * Receiving one again would spend the wallet's own copy, so proofs the open
 * wallet stores are finished with. Returns the rest.
 */
async function leaveOutHeldProofs(run: GroupRun): Promise<LegacyProof[]> {
  const remaining = remainingProofs(run.group, run.record);
  const held = await run.ports.wallet.heldSecrets(
    run.group.mintUrl,
    remaining.map((proof) => proof.secret)
  );
  await finish(
    run,
    remaining.filter((proof) => held.has(proof.secret)),
    "inWallet",
    run.ports.accountIndex === 0 && run.record.firstAccountComparison !== "compared"
      ? { firstAccountComparison: "compared" }
      : {}
  );
  return remaining.filter((proof) => !held.has(proof.secret));
}

/**
 * Claims proofs, and when the mint says some of them are not valid, halves
 * the batch until the bad ones are found. One bad proof then costs only
 * itself: it is counted as failed and stays in the old row.
 */
async function claimProofs(run: GroupRun, unit: string, proofs: LegacyProof[]): Promise<void> {
  try {
    await claimBatch(run, unit, proofs);
  } catch (error) {
    if (classifyLegacyClaimError(error) !== "proofs-rejected") throw error;
    if (proofs.length === 1) {
      await finish(run, proofs, "failed", { lastError: "proofs-rejected" });
      return;
    }
    const half = Math.ceil(proofs.length / 2);
    await claimProofs(run, unit, proofs.slice(0, half));
    await claimProofs(run, unit, proofs.slice(half));
  }
}

async function workOnGroup(run: GroupRun): Promise<void> {
  const { ports, group } = run;
  await settleInterruptedClaim(run);

  const remaining = await leaveOutHeldProofs(run);

  let unspent: LegacyProof[] = [];
  let pending = 0;
  if (remaining.length > 0) {
    const states = await ports.mint.checkStates(group.mintUrl, remaining);
    if (states.length !== remaining.length) throw new LegacyClaimFault("transient");
    await finish(
      run,
      remaining.filter((_, index) => states[index] === "SPENT"),
      "spent"
    );
    unspent = remaining.filter((_, index) => states[index] === "UNSPENT");
    pending = states.filter((state) => state === "PENDING").length;
  }

  if (unspent.length > 0) {
    if (!(await ports.wallet.isTrusted(group.mintUrl))) {
      await save(run, { status: "awaiting-trust", awaiting: sumAmounts(unspent) });
      return;
    }
    const unit = run.record.unit ?? (await ports.mint.keysetUnits(group.mintUrl)).get(group.keysetId);
    if (unit === undefined) throw new LegacyClaimFault("keyset-unknown");
    await save(run, { unit, awaiting: sumAmounts(unspent) });
    for (let start = 0; start < unspent.length; start += CLAIM_BATCH_SIZE) {
      await claimProofs(run, unit, unspent.slice(start, start + CLAIM_BATCH_SIZE));
    }
  }

  if (pending > 0) throw new LegacyClaimFault("pending");
  // A proof the mint rejected was never claimed, so the group is not settled.
  await save(
    run,
    run.record.failed > 0
      ? { status: "could-not-claim", awaiting: 0 }
      : { status: "settled", awaiting: 0, lastError: null }
  );
}

async function recordFailure(run: GroupRun, error: unknown): Promise<void> {
  const errorClass = classifyLegacyClaimError(error);
  const attempts = run.record.attempts + 1;
  const final = FINAL_ERROR_CLASSES.has(errorClass) || attempts >= LEGACY_CLAIM_MAX_ATTEMPTS;
  logger.warn("legacy_ecash.group.failed", { errorClass, attempts, final, error });
  await save(run, {
    attempts,
    lastError: errorClass,
    ...(final
      ? {
          status: "could-not-claim" as const,
          failed: run.record.failed + sumAmounts(remainingProofs(run.group, run.record)),
          awaiting: 0,
        }
      : { nextAttemptAt: run.ports.nowMs + RETRY_DELAYS_MS[attempts - 1]! }),
  });
}

/** Whether a group is worked on in this run, deciding the two states that wait on trust. */
async function isDue(run: GroupRun): Promise<boolean> {
  const { record, ports } = run;
  if (record.status === "settled" || record.status === "could-not-claim") return false;
  if (record.status === "awaiting-trust" || record.status === "left-unclaimed") {
    // No request leaves the phone for a mint that is still waiting on the person.
    if (!(await ports.wallet.isTrusted(record.mintUrl))) return false;
    await save(run, { status: "open" });
    return true;
  }
  return record.attempts === 0 || ports.nowMs >= record.nextAttemptAt;
}

/** Whether the mint's answer shows there is nothing to mint, ecash to mint, or neither. */
function quoteOutcome(
  answer: LegacyMintQuoteAnswer,
  nowMs: number
): "nothing-to-claim" | "paid-unclaimed" | null {
  if (answer.state === "paid") return "paid-unclaimed";
  if (answer.state === "issued" || answer.state === "unknown-quote") return "nothing-to-claim";
  // Unpaid settles it only once the invoice can no longer be paid.
  const expired = answer.expirySec !== null && answer.expirySec * 1000 < nowMs;
  return expired ? "nothing-to-claim" : null;
}

async function checkQuote(ports: LegacyClaimPorts, quote: LegacyMintQuote): Promise<void> {
  const id = legacyQuoteRecordId(quote);
  const record: LegacyQuoteRecord = ports.records.read().quotes[id] ?? {
    mintUrl: quote.mintUrl,
    amount: quote.amount,
    unit: quote.unit,
    status: "open",
    attempts: 0,
    nextAttemptAt: 0,
  };
  if (record.status !== "open") return;
  if (record.attempts > 0 && ports.nowMs < record.nextAttemptAt) return;

  let outcome: ReturnType<typeof quoteOutcome> = null;
  try {
    outcome = quoteOutcome(await ports.mint.quoteState(quote.mintUrl, quote.mintQuoteId), ports.nowMs);
  } catch (error) {
    if (error instanceof LegacyClaimStopped) throw error;
    logger.warn("legacy_ecash.quote.failed", { attempts: record.attempts + 1, error });
  }
  if (outcome) {
    await ports.records.writeQuote(id, { ...record, status: outcome });
    return;
  }
  // No answer, or one that proves nothing either way. After the last attempt
  // the invoice stays unresolved, which keeps the old row.
  const attempts = record.attempts + 1;
  const final = attempts >= LEGACY_CLAIM_MAX_ATTEMPTS;
  await ports.records.writeQuote(id, {
    ...record,
    attempts,
    status: final ? "unresolved" : "open",
    nextAttemptAt: final ? 0 : ports.nowMs + RETRY_DELAYS_MS[attempts - 1]!,
  });
}

/**
 * Account 0 is open: compare a group that belongs elsewhere with this wallet,
 * so its own account never receives a proof this one already stores.
 */
async function compareWithFirstAccount(run: GroupRun): Promise<void> {
  const remaining = await leaveOutHeldProofs(run);
  await save(run, {
    firstAccountComparison: "compared",
    ...(remaining.length === 0 ? { status: "settled" as const, awaiting: 0 } : {}),
  });
}

/**
 * One pass over the row for the open account. Mints are worked through one at
 * a time. Never rejects: a failure is recorded on its group and the pass moves
 * on, and a pass whose wallet is no longer open stops without writing.
 */
export async function runLegacyEcashClaim(
  read: Extract<LegacyEcashRead, { kind: "read" }>,
  unguarded: LegacyClaimPorts
): Promise<void> {
  if (!unguarded.isLive()) return;
  const ports = stopWhenNotLive(unguarded);
  try {
    for (const group of read.groups) {
      const accountIndex = ports.targetAccount(group);
      const stored = ports.records.read().groups[group.id];
      const run: GroupRun = {
        group,
        ports,
        record: stored ? { ...stored, accountIndex } : freshRecord(group, accountIndex),
      };
      const final = run.record.status === "settled" || run.record.status === "could-not-claim";
      if (accountIndex !== ports.accountIndex) {
        const compared = run.record.firstAccountComparison !== "pending";
        if (ports.accountIndex !== 0 || final || compared) continue;
        try {
          await compareWithFirstAccount(run);
        } catch (error) {
          if (error instanceof LegacyClaimStopped) throw error;
          // A local read failed. Nothing is claimed until it has succeeded.
          logger.warn("legacy_ecash.compare.failed", { error });
        }
        continue;
      }
      const claimingAccount = run.record.claiming?.accountIndex;
      try {
        if (run.record.firstAccountComparison === "pending" && accountIndex !== 0) {
          // Account 0 exists and has not been opened on this build yet.
          if (ports.accounts.includes(0)) continue;
          // No account 0, so no wallet that could already hold these proofs.
          await save(run, { firstAccountComparison: "no-first-account" });
        }
        if (claimingAccount !== undefined && claimingAccount !== ports.accountIndex) {
          // A claim another account started is that account's to finish.
          if (ports.accounts.includes(claimingAccount)) continue;
          // That account was removed, and its wallet's record of the claim
          // with it. The mint is asked about the proofs again below.
          await save(run, { claiming: null });
        }
        if (!(await isDue(run))) continue;
        await workOnGroup(run);
      } catch (error) {
        if (error instanceof LegacyClaimStopped) throw error;
        await recordFailure(run, error);
      }
    }
    for (const quote of read.mintQuotes) await checkQuote(ports, quote);
  } catch (error) {
    if (error instanceof LegacyClaimStopped) return;
    // The record could not be saved. The next launch asks again.
    logger.error("legacy_ecash.record.write_failed", { error });
  }
}

interface LegacyEcashVerdict {
  /** True when the row holds nothing that is still owed to the person. */
  rowIsSpent: boolean;
  /** Face value per unit, for the note left behind when the row is removed. */
  claimed: Record<string, number>;
  spent: Record<string, number>;
  inWallet: Record<string, number>;
}

/**
 * Whether every proof in the row is in a wallet or spent, and every old
 * invoice is known to have nothing waiting. Anything given up on, declined,
 * unreadable or unanswered keeps the row.
 */
export function legacyEcashVerdict(
  read: Extract<LegacyEcashRead, { kind: "read" }>,
  records: LegacyEcashRecords
): LegacyEcashVerdict {
  const verdict: LegacyEcashVerdict = { rowIsSpent: read.skipped === 0, claimed: {}, spent: {}, inWallet: {} };
  for (const group of read.groups) {
    const record = records.groups[group.id];
    if (record?.status !== "settled" || remainingProofs(group, record).length > 0) {
      verdict.rowIsSpent = false;
      continue;
    }
    const unit = record.unit ?? "unknown";
    for (const tally of ["claimed", "spent", "inWallet"] as const) {
      if (record[tally] > 0) verdict[tally][unit] = (verdict[tally][unit] ?? 0) + record[tally];
    }
  }
  for (const quote of read.mintQuotes) {
    if (records.quotes[legacyQuoteRecordId(quote)]?.status !== "nothing-to-claim") {
      verdict.rowIsSpent = false;
    }
  }
  return verdict;
}
