/**
 * Durable fund-liability ledger.
 *
 * One leg owns one concrete wallet asset location: mint + unit + account. The
 * public ledger contains only custody metadata, never recovery material. A leg
 * is safe to forget only after its funded value is exactly accounted for by
 * external outflows, declared fees, recovered value, and a zero-residual sweep.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { hasCustody, type CustodyHandle } from './custody';
import {
  acquireDurableLease,
  durableAppendFile,
  ensurePrivateDirectory,
  type DurableLease,
} from './durable';

const nonNegativeAmount = z.number().int().nonnegative();
const positiveAmount = z.number().int().positive();

export const assetLocationSchema = z.strictObject({
  mintUrl: z.string().url(),
  unit: z.string().min(1).max(16),
  accountIndex: z.number().int().nonnegative(),
});
export type AssetLocation = z.infer<typeof assetLocationSchema>;

const custodyHandleSchema = z.strictObject({
  id: z.string().regex(/^[0-9a-f]{16}$/),
  kind: z.enum([
    'mnemonic',
    'nsec',
    'privkey',
    'cashu-token',
    'cashu-proof',
    'bolt11',
    'payment-request',
    'lightning-address',
    'onchain-address',
    'clipboard',
    'cocod-arg',
  ]),
  len: z.number().int().positive(),
  fingerprint: z.string().regex(/^[0-9a-f]{12}$/),
});

const entryBase = {
  v: z.literal(1),
  runId: z.string().min(1),
  legId: z.string().min(1),
  ts: z.number().int().nonnegative(),
};

export const ledgerEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...entryBase,
    kind: z.literal('intent'),
    custody: custodyHandleSchema,
    counterparty: z.string().min(1),
    asset: assetLocationSchema,
    expectedAmount: positiveAmount,
  }),
  z.strictObject({
    ...entryBase,
    kind: z.literal('funded'),
    amount: positiveAmount,
    fees: nonNegativeAmount,
    txId: z.string().min(1).max(300).optional(),
  }),
  z.strictObject({
    ...entryBase,
    kind: z.literal('outflow'),
    amount: positiveAmount,
    fees: nonNegativeAmount,
    counterparty: z.string().min(1),
    txId: z.string().min(1).max(300).optional(),
  }),
  z.strictObject({
    ...entryBase,
    kind: z.literal('sweep'),
    asset: assetLocationSchema,
    ok: z.boolean(),
    recoveredAmount: nonNegativeAmount,
    residualAmount: nonNegativeAmount,
    fees: nonNegativeAmount,
    txId: z.string().min(1).max(300).optional(),
  }),
  z.strictObject({
    ...entryBase,
    kind: z.literal('written-off'),
    amount: positiveAmount,
    reason: z.string().min(1).max(500),
  }),
  z.strictObject({
    ...entryBase,
    kind: z.literal('transfer-out'),
    amount: positiveAmount,
    fees: nonNegativeAmount,
    toLegId: z.string().min(1),
  }),
  z.strictObject({
    ...entryBase,
    kind: z.literal('transfer-in'),
    amount: positiveAmount,
    fromLegId: z.string().min(1),
  }),
  z.strictObject({
    ...entryBase,
    kind: z.literal('reconciled'),
    fundedAmount: positiveAmount,
    recoveredAmount: nonNegativeAmount,
    outflowAmount: nonNegativeAmount,
    writtenOffAmount: nonNegativeAmount.optional(),
    transferOutAmount: nonNegativeAmount.optional(),
    transferInAmount: nonNegativeAmount.optional(),
    fees: nonNegativeAmount,
  }),
  z.strictObject({
    ...entryBase,
    kind: z.literal('cancelled'),
    expectedAmount: positiveAmount,
    reason: z.literal('effect-not-observed'),
  }),
  z.strictObject({
    ...entryBase,
    kind: z.literal('quarantined'),
    reason: z.string().min(1).max(500),
  }),
]);

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
export type LegStatus = 'intent' | 'funded' | 'swept' | 'reconciled' | 'cancelled' | 'quarantined';
export interface BlockingLeg {
  legId: string;
  status: Exclude<LegStatus, 'reconciled' | 'cancelled'>;
  asset: AssetLocation;
}
export type FundingLiability = Pick<
  Extract<LedgerEntry, { kind: 'intent' }>,
  'legId' | 'custody' | 'counterparty' | 'asset' | 'expectedAmount'
>;

export function blockingLegsFromEntries(entries: LedgerEntry[]): BlockingLeg[] {
  const status = new Map<string, LegStatus>();
  const intents = new Map<string, Extract<LedgerEntry, { kind: 'intent' }>>();
  for (const entry of entries) {
    if (entry.kind === 'intent') {
      intents.set(entry.legId, entry);
      if (!status.has(entry.legId)) status.set(entry.legId, 'intent');
    } else if (entry.kind === 'funded') {
      status.set(entry.legId, 'funded');
    } else if (entry.kind === 'sweep' && entry.ok && entry.residualAmount === 0) {
      status.set(entry.legId, 'swept');
    } else if (entry.kind === 'quarantined') {
      status.set(entry.legId, 'quarantined');
    } else if (entry.kind === 'reconciled') {
      status.set(entry.legId, 'reconciled');
    } else if (entry.kind === 'cancelled') {
      status.set(entry.legId, 'cancelled');
    }
  }
  return [...status]
    .filter((entry): entry is [string, Exclude<LegStatus, 'reconciled' | 'cancelled'>] => {
      return entry[1] !== 'reconciled' && entry[1] !== 'cancelled';
    })
    .map(([legId, legStatus]) => {
      const intent = intents.get(legId);
      if (!intent) throw new Error(`ledger corrupt — leg "${legId}" has no intent`);
      return { legId, status: legStatus, asset: intent.asset };
    });
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type AppendEntry = DistributiveOmit<LedgerEntry, 'v' | 'runId' | 'ts'>;

const assetKey = (asset: AssetLocation): string =>
  `${asset.mintUrl}\u0000${asset.unit}\u0000${asset.accountIndex}`;

export function effectLeasePath(base: string, runId: string, legId: string): string {
  const key = createHash('sha256').update(runId).update('\0').update(legId).digest('hex');
  return join(base, 'effect-leases', `${key}.lock`);
}

function reconciliationSummary(
  entries: LedgerEntry[],
  legId: string
): {
  fundedAmount: number;
  recoveredAmount: number;
  outflowAmount: number;
  writtenOffAmount: number;
  transferOutAmount: number;
  transferInAmount: number;
  fees: number;
} {
  const legEntries = entries.filter((entry) => entry.legId === legId);
  const funded = legEntries.find(
    (entry): entry is Extract<LedgerEntry, { kind: 'funded' }> => entry.kind === 'funded'
  );
  if (!funded) throw new Error(`funded entry missing for leg "${legId}"`);
  const sweeps = legEntries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: 'sweep' }> => entry.kind === 'sweep'
  );
  if (sweeps.length === 0) throw new Error(`cannot reconcile ${legId}: no sweep recorded`);
  const finalSweep = sweeps.at(-1)!;
  if (!finalSweep.ok) throw new Error(`cannot reconcile ${legId}: final sweep failed`);
  if (finalSweep.residualAmount !== 0) {
    throw new Error(
      `cannot reconcile ${legId}: final sweep left residual ${finalSweep.residualAmount} ${finalSweep.asset.unit}`
    );
  }
  const outflows = legEntries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: 'outflow' }> => entry.kind === 'outflow'
  );
  const writeOffs = legEntries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: 'written-off' }> => entry.kind === 'written-off'
  );
  const transferOuts = legEntries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: 'transfer-out' }> =>
      entry.kind === 'transfer-out'
  );
  const transferIns = legEntries.filter(
    (entry): entry is Extract<LedgerEntry, { kind: 'transfer-in' }> => entry.kind === 'transfer-in'
  );
  const recoveredAmount = sweeps.reduce((sum, sweep) => sum + sweep.recoveredAmount, 0);
  const outflowAmount = outflows.reduce((sum, outflow) => sum + outflow.amount, 0);
  const writtenOffAmount = writeOffs.reduce((sum, entry) => sum + entry.amount, 0);
  const transferOutAmount = transferOuts.reduce((sum, entry) => sum + entry.amount, 0);
  const transferInAmount = transferIns.reduce((sum, entry) => sum + entry.amount, 0);
  const fees =
    outflows.reduce((sum, outflow) => sum + outflow.fees, 0) +
    transferOuts.reduce((sum, entry) => sum + entry.fees, 0) +
    sweeps.reduce((sum, sweep) => sum + sweep.fees, 0);
  const accounted = recoveredAmount + outflowAmount + writtenOffAmount + transferOutAmount + fees;
  if (accounted !== funded.amount + transferInAmount) {
    throw new Error(
      `cannot reconcile ${legId}: conservation mismatch (funded ${funded.amount} + transfer-in ${transferInAmount}, accounted ${accounted})`
    );
  }
  return {
    fundedAmount: funded.amount,
    recoveredAmount,
    outflowAmount,
    writtenOffAmount,
    transferOutAmount,
    transferInAmount,
    fees,
  };
}

function validateLedgerSequence(entries: LedgerEntry[]): void {
  const state = new Map<
    string,
    {
      intent?: Extract<LedgerEntry, { kind: 'intent' }>;
      funded: boolean;
      terminalSweep: boolean;
      terminal: boolean;
    }
  >();
  // Unmatched transfer-out entries awaiting their paired transfer-in. Keyed by
  // from/to/amount; the out entry is always appended first.
  const openTransfers = new Map<string, number>();
  const transferKey = (fromLegId: string, toLegId: string, amount: number): string =>
    `${fromLegId}\u0000${toLegId}\u0000${amount}`;
  for (const [index, entry] of entries.entries()) {
    const current = state.get(entry.legId) ?? {
      funded: false,
      terminalSweep: false,
      terminal: false,
    };
    const fail = (message: string): never => {
      throw new Error(`ledger corrupt at line ${index + 1} — ${message}`);
    };
    if (current.terminal) fail(`entry after reconciled or cancelled leg "${entry.legId}"`);
    if (entry.kind === 'intent') {
      if (current.intent) fail(`duplicate intent for leg "${entry.legId}"`);
      current.intent = entry;
    } else if (!current.intent) {
      fail(`${entry.kind} entry before intent for leg "${entry.legId}"`);
    } else if (entry.kind === 'cancelled') {
      if (current.funded) fail(`cancelled entry after funded leg "${entry.legId}"`);
      if (entry.expectedAmount !== current.intent.expectedAmount) {
        fail(`cancelled amount mismatch for leg "${entry.legId}"`);
      }
      current.terminal = true;
    } else if (entry.kind === 'funded') {
      if (current.funded) fail(`duplicate funded entry for leg "${entry.legId}"`);
      if (entry.amount !== current.intent.expectedAmount) {
        fail(`funded amount does not match intent for leg "${entry.legId}"`);
      }
      current.funded = true;
    } else if (entry.kind === 'outflow' || entry.kind === 'sweep' || entry.kind === 'written-off') {
      if (!current.funded) fail(`${entry.kind} entry before funded for leg "${entry.legId}"`);
      if (current.terminalSweep) {
        fail(`${entry.kind} entry after successful sweep for leg "${entry.legId}"`);
      }
      if (entry.kind === 'sweep' && assetKey(entry.asset) !== assetKey(current.intent.asset)) {
        fail(`sweep asset does not match intent for leg "${entry.legId}"`);
      }
      if (entry.kind === 'sweep' && entry.ok && entry.residualAmount === 0) {
        current.terminalSweep = true;
      }
    } else if (entry.kind === 'transfer-out') {
      if (!current.funded) fail(`transfer-out entry before funded for leg "${entry.legId}"`);
      if (current.terminalSweep) {
        fail(`transfer-out entry after successful sweep for leg "${entry.legId}"`);
      }
      if (entry.toLegId === entry.legId) fail(`transfer-out targets its own leg "${entry.legId}"`);
      if (!state.get(entry.toLegId)?.funded) {
        fail(`transfer-out targets unfunded leg "${entry.toLegId}"`);
      }
      const key = transferKey(entry.legId, entry.toLegId, entry.amount);
      openTransfers.set(key, (openTransfers.get(key) ?? 0) + 1);
    } else if (entry.kind === 'transfer-in') {
      if (!current.funded) fail(`transfer-in entry before funded for leg "${entry.legId}"`);
      if (current.terminalSweep) {
        fail(`transfer-in entry after successful sweep for leg "${entry.legId}"`);
      }
      const key = transferKey(entry.fromLegId, entry.legId, entry.amount);
      const open = openTransfers.get(key) ?? 0;
      if (open <= 0) {
        fail(`transfer-in has no matching prior transfer-out for leg "${entry.legId}"`);
      }
      openTransfers.set(key, open - 1);
    } else if (entry.kind === 'reconciled') {
      if (!current.funded) fail(`reconciled entry before funded for leg "${entry.legId}"`);
      const summary = (() => {
        try {
          return reconciliationSummary(entries.slice(0, index), entry.legId);
        } catch (error) {
          return fail(error instanceof Error ? error.message : 'invalid reconciliation');
        }
      })();
      for (const key of ['fundedAmount', 'recoveredAmount', 'outflowAmount', 'fees'] as const) {
        if (entry[key] !== summary[key]) {
          fail(`reconciled summary mismatch at ${key} for leg "${entry.legId}"`);
        }
      }
      if ((entry.writtenOffAmount ?? 0) !== summary.writtenOffAmount) {
        fail(`reconciled summary mismatch at writtenOffAmount for leg "${entry.legId}"`);
      }
      if ((entry.transferOutAmount ?? 0) !== summary.transferOutAmount) {
        fail(`reconciled summary mismatch at transferOutAmount for leg "${entry.legId}"`);
      }
      if ((entry.transferInAmount ?? 0) !== summary.transferInAmount) {
        fail(`reconciled summary mismatch at transferInAmount for leg "${entry.legId}"`);
      }
      current.terminal = true;
    }
    state.set(entry.legId, current);
  }
}

export function parseLedgerText(text: string): LedgerEntry[] {
  if (text.trim().length === 0) {
    throw new Error('ledger corrupt — empty ledger');
  }
  const entries = text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`ledger corrupt at line ${index + 1} — invalid JSON`);
      }
      const result = ledgerEntrySchema.safeParse(parsed);
      if (!result.success) {
        const paths = result.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}:${issue.code}`)
          .join(', ');
        throw new Error(`ledger corrupt at line ${index + 1} — invalid entry (${paths})`);
      }
      return result.data;
    });
  validateLedgerSequence(entries);
  return entries;
}

export class RunLedger {
  readonly path: string;
  readonly runId: string;
  readonly #base: string;
  readonly #now: () => number;

  constructor(dir: string, runId: string, now: () => number = () => Date.now()) {
    this.#base = dir;
    this.runId = runId;
    this.#now = now;
    ensurePrivateDirectory(dir);
    this.path = join(dir, 'ledger.jsonl');
  }

  #append(entry: AppendEntry): void {
    const candidate = {
      v: 1,
      runId: this.runId,
      ts: this.#now(),
      ...entry,
    };
    const parsed = ledgerEntrySchema.parse(candidate);
    const current = existsSync(this.path) ? this.read() : [];
    validateLedgerSequence([...current, parsed]);
    durableAppendFile(this.path, `${JSON.stringify(parsed)}\n`);
  }

  read(): LedgerEntry[] {
    if (!existsSync(this.path)) return [];
    const entries = parseLedgerText(readFileSync(this.path, 'utf8'));
    if (entries.some((entry) => entry.runId !== this.runId)) {
      throw new Error('ledger corrupt — run id mismatch');
    }
    return entries;
  }

  #entriesFor(legId: string): LedgerEntry[] {
    return this.read().filter((entry) => entry.legId === legId);
  }

  #intentFor(legId: string): Extract<LedgerEntry, { kind: 'intent' }> {
    const intent = this.#entriesFor(legId).find(
      (entry): entry is Extract<LedgerEntry, { kind: 'intent' }> => entry.kind === 'intent'
    );
    if (!intent) throw new Error(`funding intent missing for leg "${legId}"`);
    return intent;
  }

  #fundedFor(legId: string): Extract<LedgerEntry, { kind: 'funded' }> {
    const funded = this.#entriesFor(legId).find(
      (entry): entry is Extract<LedgerEntry, { kind: 'funded' }> => entry.kind === 'funded'
    );
    if (!funded) throw new Error(`funded entry missing for leg "${legId}"`);
    return funded;
  }

  liability(legId: string): FundingLiability {
    const { legId: id, custody, counterparty, asset, expectedAmount } = this.#intentFor(legId);
    return { legId: id, custody, counterparty, asset, expectedAmount };
  }

  /**
   * Cross-instance exclusion for effects on one liability. The opaque path
   * contains only a hash of run/leg identifiers. A retained lease is a startup
   * blocker by construction because the corresponding liability stays open.
   */
  acquireEffectLease(legId: string): DurableLease {
    this.#intentFor(legId);
    const dir = join(this.#base, 'effect-leases');
    ensurePrivateDirectory(dir);
    return acquireDurableLease(effectLeasePath(this.#base, this.runId, legId), `${process.pid}\n`);
  }

  registerFunding(input: {
    legId: string;
    custody: CustodyHandle;
    counterparty: string;
    asset: AssetLocation;
    expectedAmount: number;
  }): void {
    if (!hasCustody(this.#base, input.custody)) {
      throw new Error('custody must exist before a funding intent');
    }
    if (this.#entriesFor(input.legId).length > 0) {
      throw new Error(
        `duplicate funding leg "${input.legId}" — repeated funding requires a new leg id`
      );
    }
    const { legId, ...intent } = input;
    this.#append({ kind: 'intent', legId, ...intent });
  }

  markFunded(legId: string, funded: { amount: number; fees: number; txId?: string }): void {
    const intent = this.#intentFor(legId);
    if (this.#entriesFor(legId).some((entry) => entry.kind === 'funded')) {
      throw new Error(`funding already recorded for leg "${legId}"`);
    }
    if (funded.amount !== intent.expectedAmount) {
      throw new Error(
        `funded amount mismatch for leg "${legId}": expected ${intent.expectedAmount}, got ${funded.amount}`
      );
    }
    this.#append({ kind: 'funded', legId, ...funded });
  }

  cancelFunding(legId: string): void {
    const intent = this.#intentFor(legId);
    const entries = this.#entriesFor(legId);
    if (entries.some((entry) => entry.kind !== 'intent' && entry.kind !== 'quarantined')) {
      throw new Error(`funding leg "${legId}" has a confirmed value transition`);
    }
    this.#append({
      kind: 'cancelled',
      legId,
      expectedAmount: intent.expectedAmount,
      reason: 'effect-not-observed',
    });
  }

  recordOutflow(
    legId: string,
    outflow: { amount: number; fees: number; counterparty: string; txId?: string }
  ): void {
    this.#fundedFor(legId);
    this.#append({ kind: 'outflow', legId, ...outflow });
  }

  /**
   * A declared app-internal move of value between two funded legs (e.g. an
   * inter-mint rebalance). Both entries are appended together, transfer-out
   * first, so the sequence validator can require every transfer-in to match a
   * prior transfer-out. `amount` is the value that arrived at the destination;
   * `fees` is what the source additionally lost moving it.
   */
  recordTransfer(input: {
    fromLegId: string;
    toLegId: string;
    amount: number;
    fees: number;
  }): void {
    this.#fundedFor(input.fromLegId);
    this.#fundedFor(input.toLegId);
    this.#append({
      kind: 'transfer-out',
      legId: input.fromLegId,
      amount: input.amount,
      fees: input.fees,
      toLegId: input.toLegId,
    });
    this.#append({
      kind: 'transfer-in',
      legId: input.toLegId,
      amount: input.amount,
      fromLegId: input.fromLegId,
    });
  }

  recordSweep(
    legId: string,
    sweep: {
      asset: AssetLocation;
      ok: boolean;
      recoveredAmount: number;
      residualAmount: number;
      fees?: number;
      txId?: string;
    }
  ): void {
    const intent = this.#intentFor(legId);
    this.#fundedFor(legId);
    if (assetKey(intent.asset) !== assetKey(sweep.asset)) {
      throw new Error(`sweep asset location does not match funding leg "${legId}"`);
    }
    this.#append({ kind: 'sweep', legId, fees: sweep.fees ?? 0, ...sweep });
  }

  quarantine(legId: string, reason: string): void {
    this.#intentFor(legId);
    this.#append({ kind: 'quarantined', legId, reason });
  }

  /**
   * Explicit operator loss acceptance for funded value that provably left the
   * counterparty but is unrecoverable from the leg's asset (e.g. a paid mint
   * quote whose id died with an ephemeral device). Never inferred by recovery
   * — only an operator command appends this, and conservation still requires
   * the write-off to exactly close the leg's principal before reconcile.
   */
  writeOff(legId: string, writeOff: { amount: number; reason: string }): void {
    const funded = this.#fundedFor(legId);
    const entries = this.#entriesFor(legId);
    const outflowAmount = entries
      .filter(
        (entry): entry is Extract<LedgerEntry, { kind: 'outflow' }> => entry.kind === 'outflow'
      )
      .reduce((sum, entry) => sum + entry.amount + entry.fees, 0);
    const writtenOffAmount = entries
      .filter(
        (entry): entry is Extract<LedgerEntry, { kind: 'written-off' }> =>
          entry.kind === 'written-off'
      )
      .reduce((sum, entry) => sum + entry.amount, 0);
    const transferNet = entries.reduce(
      (sum, entry) =>
        entry.kind === 'transfer-out'
          ? sum + entry.amount + entry.fees
          : entry.kind === 'transfer-in'
            ? sum - entry.amount
            : sum,
      0
    );
    if (outflowAmount + writtenOffAmount + transferNet + writeOff.amount > funded.amount) {
      throw new Error(
        `write-off exceeds funded principal for leg "${legId}": funded ${funded.amount}, already accounted ${outflowAmount + writtenOffAmount}, requested ${writeOff.amount}`
      );
    }
    this.#append({ kind: 'written-off', legId, ...writeOff });
  }

  reconcile(legId: string): {
    ok: true;
    fundedAmount: number;
    recoveredAmount: number;
    outflowAmount: number;
    writtenOffAmount: number;
    transferOutAmount: number;
    transferInAmount: number;
    fees: number;
  } {
    const entries = this.#entriesFor(legId);
    if (entries.some((entry) => entry.kind === 'reconciled')) {
      throw new Error(`leg "${legId}" is already reconciled`);
    }
    const summary = reconciliationSummary(entries, legId);
    const result = {
      ok: true as const,
      ...summary,
    };
    this.#append({
      kind: 'reconciled',
      legId,
      fundedAmount: result.fundedAmount,
      recoveredAmount: result.recoveredAmount,
      outflowAmount: result.outflowAmount,
      ...(result.writtenOffAmount > 0 ? { writtenOffAmount: result.writtenOffAmount } : {}),
      ...(result.transferOutAmount > 0 ? { transferOutAmount: result.transferOutAmount } : {}),
      ...(result.transferInAmount > 0 ? { transferInAmount: result.transferInAmount } : {}),
      fees: result.fees,
    });
    return result;
  }

  status(): Map<string, LegStatus> {
    const status = new Map<string, LegStatus>();
    for (const entry of this.read()) {
      if (entry.kind === 'intent' && !status.has(entry.legId)) {
        status.set(entry.legId, 'intent');
      } else if (entry.kind === 'funded') {
        status.set(entry.legId, 'funded');
      } else if (entry.kind === 'sweep' && entry.ok && entry.residualAmount === 0) {
        status.set(entry.legId, 'swept');
      } else if (entry.kind === 'quarantined') {
        status.set(entry.legId, 'quarantined');
      } else if (entry.kind === 'reconciled') {
        status.set(entry.legId, 'reconciled');
      } else if (entry.kind === 'cancelled') {
        status.set(entry.legId, 'cancelled');
      }
    }
    return status;
  }

  blockingLegs(): BlockingLeg[] {
    return blockingLegsFromEntries(this.read());
  }
}
