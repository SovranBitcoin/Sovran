import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodeBolt11Invoice } from 'wallet';

import type { CounterpartyExecutor } from '../core/run';
import { isSecret, secret, type Secret } from '../core/redact';
import type { CounterpartyStep } from '../schema';
import {
  establishFundedRecovery,
  type CocodCounterparty,
  type DeclaredRecoveryAsset,
  type FundedRecoveryReport,
  type InspectedCashuToken,
} from '../funded';
import type { FundedRecovery } from '../funded/funded-recovery';
import { assetIdentity } from '../funded/custody';
import { isValuelessTestMint, VALUELESS_WRITE_OFF_REASON } from '../funded/test-mints';
import { FundingCoordinator, type FundingEffects, type FundingLeg } from '../ledger/coordinator';
import { deleteRecovery, hasCustody, storeRecovery, type CustodyHandle } from '../ledger/custody';
import { durableReplaceFile, ensurePrivateDirectory } from '../ledger/durable';
import { RunLedger, type AssetLocation, type LedgerEntry } from '../ledger/ledger';

type LiveLeg =
  | FundingLeg<'intent'>
  | FundingLeg<'funded'>
  | FundingLeg<'swept'>
  | FundingLeg<'reconciled'>;

interface RecoveryPort {
  readonly custodyPath: string;
  readonly assets: DeclaredRecoveryAsset[];
  createCounterpartyCashu(options: {
    asset: DeclaredRecoveryAsset;
    amount: number;
    cocod: CocodCounterparty;
  }): Promise<{ token: string; amount: number }>;
  inspectCashuToken?(options: {
    asset: DeclaredRecoveryAsset;
    token: string;
  }): Promise<InspectedCashuToken>;
  reconcile(dependencies: {
    cocod: CocodCounterparty;
    acceptEmptyAssets?: readonly DeclaredRecoveryAsset[];
  }): Promise<FundedRecoveryReport>;
  disposePrivateMaterial(): void;
}

interface PendingInvoice {
  fingerprint: string;
  asset: DeclaredRecoveryAsset;
  amount: number;
  beforeBalance: number;
  settlementDeadlineMs: number;
}

interface AccountingAsset {
  asset: DeclaredRecoveryAsset;
  baseline: number;
  current: number;
}

interface AccountingObservation {
  sequence: number;
  operation: string;
  asset: DeclaredRecoveryAsset;
  before: number;
  after: number;
  delta: number;
}

interface AccountingRecord {
  version: 1;
  runId: string;
  assets: AccountingAsset[];
  observations: AccountingObservation[];
  pendingInvoices: PendingInvoice[];
  final: boolean;
}

interface CashuOutflowRecord {
  version: 1;
  id: string;
  phase: 'prepared' | 'received';
  asset: DeclaredRecoveryAsset;
  amount: number;
  tokenFingerprint: string;
  token?: string;
  beforeBalance: number;
  afterBalance?: number;
  counterpartyDelta?: number;
}

export interface FundedScenarioRuntimeOptions {
  runDir: string;
  runId: string;
  assets: readonly DeclaredRecoveryAsset[];
  cocod: CocodCounterparty;
  p2pkPrivateKey?: string;
  resolveLightningAddress: (input: {
    address: string;
    amountSats: number;
    timeoutMs: number;
  }) => Promise<string>;
  decodeBolt11Amount?: (invoice: string) => number | null;
  refreshApp?: () => Promise<void>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  recoveryFactory?: (input: {
    runDir: string;
    appMnemonic: string;
    assets: readonly DeclaredRecoveryAsset[];
    p2pkPrivateKey?: string;
  }) => RecoveryPort;
}

const fingerprint = (value: string): string => createHash('sha256').update(value).digest('hex');

const locationIdentity = (asset: AssetLocation): string =>
  `${asset.mintUrl}\u0000${asset.unit}\u0000${asset.accountIndex}`;

function exactAmount(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${context} must be a positive safe integer`);
  }
  return value as number;
}

function rawSecret(value: unknown, kind: Secret['kind']): string {
  if (!isSecret(value) || value.kind !== kind) {
    throw new Error(`${kind} must cross the funded runtime as a typed secret`);
  }
  return value.reveal();
}

function exactAssetFromStep(
  step: CounterpartyStep,
  declared: readonly DeclaredRecoveryAsset[]
): DeclaredRecoveryAsset {
  if (
    typeof step.mintUrl !== 'string' ||
    typeof step.unit !== 'string' ||
    !Number.isSafeInteger(step.accountIndex)
  ) {
    throw new Error(`${step.operation} contains an unresolved asset parameter`);
  }
  const requested = `${step.mintUrl}\u0000${step.unit}\u0000${step.accountIndex}`;
  const asset = declared.find((candidate) => assetIdentity(candidate) === requested);
  if (!asset) throw new Error(`${step.operation} requested an undeclared funded asset`);
  return asset;
}

class CocodAccounting {
  readonly #path: string;
  readonly #record: AccountingRecord;

  constructor(runDir: string, runId: string) {
    const dir = join(runDir, 'funded-runtime');
    ensurePrivateDirectory(dir);
    this.#path = join(dir, 'cocod-accounting.json');
    if (existsSync(this.#path)) {
      throw new Error('cocod accounting already exists for this funded scenario');
    }
    this.#record = {
      version: 1,
      runId,
      assets: [],
      observations: [],
      pendingInvoices: [],
      final: false,
    };
    this.#persist();
  }

  #persist(): void {
    durableReplaceFile(this.#path, JSON.stringify(this.#record), 0o600);
  }

  #state(asset: DeclaredRecoveryAsset): AccountingAsset | undefined {
    const id = assetIdentity(asset);
    return this.#record.assets.find((candidate) => assetIdentity(candidate.asset) === id);
  }

  assertCurrent(asset: DeclaredRecoveryAsset, observed: number): void {
    if (!Number.isSafeInteger(observed) || observed < 0) {
      throw new Error('cocod returned an invalid exact balance');
    }
    const state = this.#state(asset);
    if (!state) {
      this.#record.assets.push({ asset, baseline: observed, current: observed });
      this.#persist();
      return;
    }
    if (state.current !== observed) {
      throw new Error('cocod balance changed outside an observed funded operation');
    }
  }

  record(operation: string, asset: DeclaredRecoveryAsset, before: number, after: number): void {
    this.assertCurrent(asset, before);
    if (!Number.isSafeInteger(after) || after < 0) {
      throw new Error('cocod returned an invalid exact balance');
    }
    const state = this.#state(asset)!;
    this.#record.observations.push({
      sequence: this.#record.observations.length + 1,
      operation,
      asset,
      before,
      after,
      delta: after - before,
    });
    state.current = after;
    this.#persist();
  }

  addPendingInvoice(invoice: PendingInvoice): void {
    if (
      this.#record.pendingInvoices.some(({ fingerprint }) => fingerprint === invoice.fingerprint)
    ) {
      throw new Error('duplicate cocod invoice fingerprint');
    }
    this.#record.pendingInvoices.push(invoice);
    this.#persist();
  }

  pendingInvoice(invoiceFingerprint: string): PendingInvoice | undefined {
    return this.#record.pendingInvoices.find(
      ({ fingerprint: candidate }) => candidate === invoiceFingerprint
    );
  }

  pendingInvoices(): PendingInvoice[] {
    return structuredClone(this.#record.pendingInvoices);
  }

  removePendingInvoice(invoiceFingerprint: string): void {
    const index = this.#record.pendingInvoices.findIndex(
      ({ fingerprint: candidate }) => candidate === invoiceFingerprint
    );
    if (index === -1) throw new Error('unknown cocod invoice settlement');
    this.#record.pendingInvoices.splice(index, 1);
    this.#persist();
  }

  finalize(balances: ReadonlyMap<string, number>): void {
    if (this.#record.pendingInvoices.length > 0) {
      throw new Error('cocod accounting still has pending invoice observations');
    }
    for (const state of this.#record.assets) {
      const observed = balances.get(assetIdentity(state.asset));
      if (observed === undefined || observed !== state.current) {
        throw new Error('final cocod balance does not match observed operation deltas');
      }
      const delta = this.#record.observations
        .filter(({ asset }) => assetIdentity(asset) === assetIdentity(state.asset))
        .reduce((sum, observation) => sum + observation.delta, 0);
      if (state.baseline + delta !== observed) {
        throw new Error('cocod accounting failed exact balance conservation');
      }
    }
    this.#record.final = true;
    this.#persist();
  }
}

export class FundedScenarioRuntime implements CounterpartyExecutor {
  readonly #runDir: string;
  readonly #runId: string;
  readonly #assets: DeclaredRecoveryAsset[];
  readonly #cocod: CocodCounterparty;
  readonly #p2pkPrivateKey?: string;
  readonly #resolveLightningAddress: FundedScenarioRuntimeOptions['resolveLightningAddress'];
  readonly #decodeBolt11Amount: NonNullable<FundedScenarioRuntimeOptions['decodeBolt11Amount']>;
  readonly #refreshApp?: () => Promise<void>;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #recoveryFactory: NonNullable<FundedScenarioRuntimeOptions['recoveryFactory']>;
  readonly #ledger: RunLedger;
  readonly #accounting: CocodAccounting;
  readonly #legs = new Map<string, LiveLeg>();
  readonly #outflowTotals = new Map<string, number>();
  #coordinator: FundingCoordinator;
  #recovery?: RecoveryPort;
  #mnemonic?: Secret;
  #mnemonicFingerprint?: string;
  #custodyHandle?: CustodyHandle;
  #pendingEffect?: {
    kind: 'fund' | 'outflow' | 'sweep';
    assetId: string;
    task: () => Promise<unknown>;
  };
  #report?: FundedRecoveryReport;
  #sweepResults = new Map<
    string,
    { ok: true; recoveredAmount: number; residualAmount: 0; fees: number }
  >();
  #reconciled = false;
  #refreshedAfterSweep = false;

  constructor(options: FundedScenarioRuntimeOptions) {
    if (options.assets.length === 0) throw new Error('funded runtime requires declared assets');
    const seen = new Set<string>();
    this.#assets = options.assets.map((asset) => {
      if (asset.accountIndex !== 0 || !Number.isSafeInteger(asset.maxPrincipal)) {
        throw new Error('funded runtime received an invalid recovery asset');
      }
      const id = assetIdentity(asset);
      if (seen.has(id)) throw new Error('funded runtime received a duplicate recovery asset');
      seen.add(id);
      return { ...asset };
    });
    this.#runDir = options.runDir;
    this.#runId = options.runId;
    this.#cocod = options.cocod;
    this.#p2pkPrivateKey = options.p2pkPrivateKey;
    this.#resolveLightningAddress = options.resolveLightningAddress;
    this.#decodeBolt11Amount =
      options.decodeBolt11Amount ?? ((invoice) => decodeBolt11Invoice(invoice)?.amountSat ?? null);
    this.#refreshApp = options.refreshApp;
    this.#now = options.now ?? (() => Date.now());
    this.#sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#recoveryFactory =
      options.recoveryFactory ?? ((input) => establishFundedRecovery(input) as FundedRecovery);
    const liabilityDir = join(this.#runDir, 'funded-liability');
    this.#ledger = new RunLedger(liabilityDir, this.#runId, this.#now);
    this.#accounting = new CocodAccounting(this.#runDir, this.#runId);

    const effects: FundingEffects = {
      fund: (request) => this.#runStagedEffect('fund', request.asset),
      outflow: (request) => this.#runStagedEffect('outflow', request.asset),
      sweep: (request) => this.#runStagedEffect('sweep', request.asset),
    };
    this.#coordinator = new FundingCoordinator(this.#ledger, effects, {
      assertReady: ({ custody, asset }) => {
        if (!this.#recovery || !this.#custodyHandle || custody.id !== this.#custodyHandle.id) {
          throw new Error('funded recovery custody is not ready');
        }
        if (!hasCustody(liabilityDir, custody)) {
          throw new Error('funded recovery custody handle failed validation');
        }
        if (
          !this.#assets.some((candidate) => assetIdentity(candidate) === locationIdentity(asset))
        ) {
          throw new Error('funded liability requested an undeclared asset');
        }
      },
    });
  }

  get assets(): readonly DeclaredRecoveryAsset[] {
    return this.#assets;
  }

  get fundsReconciled(): boolean {
    return this.#reconciled;
  }

  captureMnemonic(mnemonic: string): void {
    const normalized = mnemonic.trim().toLowerCase().split(/\s+/).join(' ');
    const mnemonicFingerprint = fingerprint(normalized);
    if (this.#mnemonicFingerprint) {
      if (this.#mnemonicFingerprint !== mnemonicFingerprint) {
        throw new Error('ephemeral simulator exported more than one wallet mnemonic');
      }
      return;
    }
    this.#recovery = this.#recoveryFactory({
      runDir: this.#runDir,
      appMnemonic: normalized,
      assets: this.#assets,
      ...(this.#p2pkPrivateKey ? { p2pkPrivateKey: this.#p2pkPrivateKey } : {}),
    });
    this.#mnemonic = secret('mnemonic', normalized);
    this.#mnemonicFingerprint = mnemonicFingerprint;
  }

  async execute(step: CounterpartyStep): Promise<{ output?: Secret }> {
    const asset = exactAssetFromStep(step, this.#assets);
    const amount = 'amount' in step ? exactAmount(step.amount, step.operation) : undefined;
    const timeoutMs = step.timeoutMs ?? 60_000;
    switch (step.operation) {
      case 'cashu.create': {
        const recovery = this.#requireRecovery();
        const created = await this.#fund(asset, amount!, async () => {
          const before = await this.#exactBalance(asset);
          this.#accounting.assertCurrent(asset, before);
          const result = await recovery.createCounterpartyCashu({
            asset,
            amount: amount!,
            cocod: this.#cocod,
          });
          const after = await this.#exactBalance(asset);
          if (before - after < amount!) {
            throw new Error('cocod Cashu creation did not debit the declared principal');
          }
          this.#accounting.record('cashu.create', asset, before, after);
          return { effect: { amount: amount!, fees: 0 }, output: result };
        });
        return {
          output: secret('cashu-token', created.token, {
            amountSat: amount,
            unit: asset.unit,
            mintHost: new URL(asset.mintUrl).host,
          }),
        };
      }
      case 'cashu.redeem': {
        const token = rawSecret(step.token, 'cashu-token');
        const recovery = this.#requireRecovery();
        if (!recovery.inspectCashuToken) {
          throw new Error('funded recovery cannot inspect an app Cashu token');
        }
        const inspected = await recovery.inspectCashuToken({ asset, token });
        if (
          inspected.totalAmount !== amount ||
          inspected.unspentAmount !== amount ||
          inspected.pendingAmount !== 0 ||
          inspected.spentAmount !== 0
        ) {
          throw new Error('app Cashu token failed exact pre-redemption validation');
        }
        await this.#outflow(asset, amount!, async () => {
          const before = await this.#exactBalance(asset);
          this.#accounting.assertCurrent(asset, before);
          const outflow = this.#persistCashuOutflow(asset, amount!, token, before);
          const received = await this.#cocod.receiveCashu(token);
          if (received.reportedAmount !== amount) {
            throw new Error('cocod reported a different Cashu outflow amount');
          }
          const after = await this.#exactBalance(asset);
          const delta = after - before;
          if (delta <= 0 || delta > amount!) {
            throw new Error('cocod Cashu redemption has an invalid exact balance delta');
          }
          this.#completeCashuOutflow(outflow, after, delta);
          this.#accounting.record('cashu.redeem', asset, before, after);
          return { amount: amount!, fees: 0, txId: outflow.id };
        });
        return {};
      }
      case 'bolt11.create': {
        const before = await this.#exactBalance(asset);
        this.#accounting.assertCurrent(asset, before);
        const created = await this.#cocod.createBolt11(asset, amount!);
        if (created.amount !== amount) throw new Error('cocod created the wrong invoice amount');
        const after = await this.#exactBalance(asset);
        if (after !== before) throw new Error('cocod invoice creation unexpectedly moved value');
        this.#accounting.record('bolt11.create', asset, before, after);
        this.#accounting.addPendingInvoice({
          fingerprint: fingerprint(created.invoice),
          asset,
          amount: amount!,
          beforeBalance: after,
          settlementDeadlineMs: this.#now() + timeoutMs,
        });
        return {
          output: secret('bolt11', created.invoice, {
            amountSat: amount,
            unit: asset.unit,
            mintHost: new URL(asset.mintUrl).host,
          }),
        };
      }
      case 'bolt11.pay': {
        const invoice = rawSecret(step.invoice, 'bolt11');
        this.#assertBolt11Amount(invoice, amount!);
        await this.#fund(asset, amount!, () => this.#payBolt11(asset, invoice, amount!));
        return {};
      }
      case 'bolt11.settled': {
        const invoice = rawSecret(step.invoice, 'bolt11');
        await this.#settleInvoice(asset, amount!, invoice, timeoutMs, true);
        return {};
      }
      case 'lightning-address.resolve': {
        const address = rawSecret(step.address, 'lightning-address');
        const invoice = await this.#resolveLightningAddress({
          address,
          amountSats: amount!,
          timeoutMs,
        });
        return {
          output: secret('bolt11', invoice, {
            amountSat: amount,
            unit: asset.unit,
            mintHost: new URL(asset.mintUrl).host,
          }),
        };
      }
      case 'lightning-address.pay': {
        const address = rawSecret(step.address, 'lightning-address');
        const invoice = await this.#resolveLightningAddress({
          address,
          amountSats: amount!,
          timeoutMs,
        });
        this.#assertBolt11Amount(invoice, amount!);
        await this.#fund(asset, amount!, () => this.#payBolt11(asset, invoice, amount!));
        return {};
      }
      case 'recovery.sweep':
        await this.#reconcileHost();
        await this.#refreshAfterSweep();
        return {};
    }
  }

  async reconcile(): Promise<'reconciled'> {
    await this.#reconcileHost();
    return 'reconciled';
  }

  async #runStagedEffect<T>(kind: 'fund' | 'outflow' | 'sweep', asset: AssetLocation): Promise<T> {
    const staged = this.#pendingEffect;
    if (!staged || staged.kind !== kind || staged.assetId !== locationIdentity(asset)) {
      throw new Error(`funded ${kind} effect was not staged for this exact asset`);
    }
    return (await staged.task()) as T;
  }

  async #stage<T>(
    kind: 'fund' | 'outflow' | 'sweep',
    asset: DeclaredRecoveryAsset,
    task: () => Promise<T>,
    invoke: () => Promise<unknown>
  ): Promise<T> {
    if (this.#pendingEffect) throw new Error('another funded value operation is already active');
    let result: T | undefined;
    this.#pendingEffect = {
      kind,
      assetId: assetIdentity(asset),
      task: async () => {
        result = await task();
        return result;
      },
    };
    try {
      await invoke();
      if (result === undefined) throw new Error(`funded ${kind} effect returned no result`);
      return result;
    } finally {
      this.#pendingEffect = undefined;
    }
  }

  #requireRecovery(): RecoveryPort {
    if (!this.#recovery || !this.#mnemonic) {
      throw new Error('funded value operation started before simulator seed custody was ready');
    }
    return this.#recovery;
  }

  #ensureIntent(asset: DeclaredRecoveryAsset): FundingLeg<'intent'> {
    const id = assetIdentity(asset);
    const existing = this.#legs.get(id);
    if (existing) {
      if (existing.state !== 'intent') throw new Error('funded asset already has a funding effect');
      return existing;
    }
    const mnemonic = this.#mnemonic;
    this.#requireRecovery();
    if (!mnemonic) throw new Error('funded recovery mnemonic is unavailable');
    const liabilityDir = join(this.#runDir, 'funded-liability');
    this.#custodyHandle ??= storeRecovery(liabilityDir, 'mnemonic', mnemonic.reveal());
    const index = this.#assets.findIndex(
      (candidate) => assetIdentity(candidate) === assetIdentity(asset)
    );
    const leg = this.#coordinator.prepareFunding({
      legId: `asset-${String(index + 1).padStart(2, '0')}`,
      custody: this.#custodyHandle,
      counterparty: 'cocod-test-wallet',
      asset: {
        mintUrl: asset.mintUrl,
        unit: asset.unit,
        accountIndex: asset.accountIndex,
      },
      expectedAmount: asset.maxPrincipal,
    });
    this.#legs.set(id, leg);
    return leg;
  }

  async #fund<T>(
    asset: DeclaredRecoveryAsset,
    amount: number,
    effect: () => Promise<
      | { effect: { amount: number; fees: number }; output: T }
      | {
          amount: number;
          fees: number;
        }
    >
  ): Promise<T> {
    if (amount !== asset.maxPrincipal) {
      throw new Error('first funding effect must equal the declared asset maxPrincipal');
    }
    const intent = this.#ensureIntent(asset);
    let output: T | undefined;
    await this.#stage(
      'fund',
      asset,
      async () => {
        const result = await effect();
        if ('effect' in result) {
          output = result.output;
          return result.effect;
        }
        return result;
      },
      async () => {
        const funded = await this.#coordinator.fund(intent);
        this.#legs.set(assetIdentity(asset), funded);
      }
    );
    return output as T;
  }

  async #outflow(
    asset: DeclaredRecoveryAsset,
    amount: number,
    effect: () => Promise<{ amount: number; fees: number }>
  ): Promise<void> {
    const current = this.#legs.get(assetIdentity(asset));
    if (!current || current.state !== 'funded') {
      throw new Error('outflow requested before the exact asset was funded');
    }
    await this.#stage('outflow', asset, effect, async () => {
      const funded = await this.#coordinator.outflow(current, {
        amount,
        counterparty: 'cocod-test-wallet',
      });
      this.#legs.set(assetIdentity(asset), funded);
    });
    this.#outflowTotals.set(
      assetIdentity(asset),
      (this.#outflowTotals.get(assetIdentity(asset)) ?? 0) + amount
    );
  }

  async #payBolt11(
    asset: DeclaredRecoveryAsset,
    invoice: string,
    amount: number
  ): Promise<{ amount: number; fees: number }> {
    const before = await this.#exactBalance(asset);
    this.#accounting.assertCurrent(asset, before);
    await this.#cocod.payBolt11(asset, invoice, amount);
    const after = await this.#exactBalance(asset);
    if (before - after < amount) {
      throw new Error('cocod Lightning payment did not debit the declared principal');
    }
    this.#accounting.record('bolt11.pay', asset, before, after);
    return { amount, fees: 0 };
  }

  #assertBolt11Amount(invoice: string, amount: number): void {
    const decodedAmount = this.#decodeBolt11Amount(invoice);
    if (!Number.isSafeInteger(decodedAmount) || decodedAmount !== amount) {
      throw new Error('app BOLT11 invoice amount does not match the declared funding principal');
    }
  }

  async #settleInvoice(
    asset: DeclaredRecoveryAsset,
    amount: number,
    invoice: string,
    timeoutMs: number,
    recordOutflow: boolean
  ): Promise<void> {
    const invoiceFingerprint = fingerprint(invoice);
    const pending = this.#accounting.pendingInvoice(invoiceFingerprint);
    if (
      !pending ||
      assetIdentity(pending.asset) !== assetIdentity(asset) ||
      pending.amount !== amount
    ) {
      throw new Error('cocod settlement does not match a prepared invoice');
    }
    const settle = async () => {
      const deadline = this.#now() + timeoutMs;
      for (;;) {
        const after = await this.#exactBalance(asset);
        const delta = after - pending.beforeBalance;
        if (delta === amount) {
          this.#accounting.record('bolt11.settled', asset, pending.beforeBalance, after);
          this.#accounting.removePendingInvoice(invoiceFingerprint);
          return { amount, fees: 0, txId: invoiceFingerprint.slice(0, 16) };
        }
        if (delta !== 0) throw new Error('cocod invoice settled with an unexpected balance delta');
        if (this.#now() >= deadline) throw new Error('cocod invoice did not settle before timeout');
        await this.#sleep(250);
      }
    };
    if (recordOutflow) await this.#outflow(asset, amount, settle);
    else await settle();
  }

  async #settleUnobservedInvoices(): Promise<void> {
    for (const pending of this.#accounting.pendingInvoices()) {
      let current: number;
      for (;;) {
        current = await this.#exactBalance(pending.asset);
        const observedDelta = current - pending.beforeBalance;
        if (observedDelta !== 0 || this.#now() >= pending.settlementDeadlineMs) break;
        await this.#sleep(250);
      }
      const delta = current - pending.beforeBalance;
      if (delta === 0) {
        this.#accounting.removePendingInvoice(pending.fingerprint);
        continue;
      }
      if (delta !== pending.amount) {
        throw new Error('pending cocod invoice has an ambiguous exact balance delta');
      }
      const leg = this.#legs.get(assetIdentity(pending.asset));
      if (!leg || leg.state !== 'funded') {
        throw new Error('settled cocod invoice has no funded app liability');
      }
      this.#accounting.record(
        'bolt11.settled.finally',
        pending.asset,
        pending.beforeBalance,
        current
      );
      this.#accounting.removePendingInvoice(pending.fingerprint);
      this.#ledger.recordOutflow(leg.legId, {
        amount: pending.amount,
        fees: 0,
        counterparty: 'cocod-test-wallet',
        txId: pending.fingerprint.slice(0, 16),
      });
      this.#outflowTotals.set(
        assetIdentity(pending.asset),
        (this.#outflowTotals.get(assetIdentity(pending.asset)) ?? 0) + pending.amount
      );
    }
  }

  async #ensureRecoveryReport(): Promise<void> {
    if (this.#report) return;
    const recovery = this.#requireRecovery();
    await this.#settleUnobservedInvoices();
    const before = new Map<string, number>();
    for (const asset of this.#assets) {
      const balance = await this.#exactBalance(asset);
      this.#accounting.assertCurrent(asset, balance);
      before.set(assetIdentity(asset), balance);
    }
    const acceptEmptyAssets = this.#assets.filter((asset) => {
      const leg = this.#legs.get(assetIdentity(asset));
      return !leg || (this.#outflowTotals.get(assetIdentity(asset)) ?? 0) === asset.maxPrincipal;
    });
    const report = await recovery.reconcile({
      cocod: this.#cocod,
      ...(acceptEmptyAssets.length > 0 ? { acceptEmptyAssets } : {}),
    });
    for (const asset of this.#assets) {
      const after = await this.#exactBalance(asset);
      this.#accounting.record('recovery.sweep', asset, before.get(assetIdentity(asset))!, after);
    }
    const sweepResults = new Map<
      string,
      { ok: true; recoveredAmount: number; residualAmount: 0; fees: number }
    >();
    for (const asset of this.#assets) {
      const id = assetIdentity(asset);
      const leg = this.#legs.get(id);
      const expectedPrincipal = leg ? asset.maxPrincipal : 0;
      const restored = report.assets.find((entry) => assetIdentity(entry.asset) === id);
      if (!restored) throw new Error('funded recovery omitted a declared asset reconciliation');
      // Valueless test mints are exempt from exact conservation: the app's
      // proofs are never scanned or swept, so whatever the recovery report
      // cannot explain (typically the token the app redeemed) is written off
      // as accepted test-fund loss instead of failing (or quarantining) the
      // run. Returned tokens still count as recovered value with their real
      // fees so the ledger's own conservation stays exact.
      if (isValuelessTestMint(asset.mintUrl)) {
        const returned = report.counterpartyTokens.filter(
          (entry) => assetIdentity(entry.asset) === id && entry.disposition === 'returned'
        );
        const recoveredAmount =
          restored.counterpartyDelta +
          returned.reduce((sum, entry) => sum + entry.counterpartyDelta, 0);
        const sweepFees =
          restored.sendFee +
          restored.receiveFee +
          returned.reduce((sum, entry) => sum + (entry.tokenAmount - entry.counterpartyDelta), 0);
        if (leg) {
          const legEntries = this.#ledger.read().filter((entry) => entry.legId === leg.legId);
          const outflowAmount = legEntries
            .filter(
              (entry): entry is Extract<LedgerEntry, { kind: 'outflow' }> =>
                entry.kind === 'outflow'
            )
            .reduce((sum, entry) => sum + entry.amount + entry.fees, 0);
          const writtenOff = legEntries
            .filter(
              (entry): entry is Extract<LedgerEntry, { kind: 'written-off' }> =>
                entry.kind === 'written-off'
            )
            .reduce((sum, entry) => sum + entry.amount, 0);
          const explainedPrincipal =
            restored.restoredAmount +
            returned.reduce((sum, entry) => sum + entry.tokenAmount, 0) +
            outflowAmount +
            writtenOff;
          const remainder = expectedPrincipal - explainedPrincipal;
          if (remainder > 0) {
            this.#ledger.writeOff(leg.legId, {
              amount: remainder,
              reason: VALUELESS_WRITE_OFF_REASON,
            });
          }
        }
        sweepResults.set(id, { ok: true, recoveredAmount, residualAmount: 0, fees: sweepFees });
        continue;
      }
      const returnedTokens = report.counterpartyTokens.filter(
        (entry) => assetIdentity(entry.asset) === id && entry.disposition === 'returned'
      );
      const recoveredAmount =
        restored.counterpartyDelta +
        returnedTokens.reduce((sum, entry) => sum + entry.counterpartyDelta, 0);
      const outflowAmount = this.#outflowTotals.get(id) ?? 0;
      const fees = expectedPrincipal - outflowAmount - recoveredAmount;
      if (!Number.isSafeInteger(fees) || fees < 0) {
        throw new Error('funded recovery cannot conserve declared principal');
      }
      const accountedPrincipal =
        restored.restoredAmount +
        returnedTokens.reduce((sum, entry) => sum + entry.tokenAmount, 0) +
        outflowAmount;
      if (accountedPrincipal !== expectedPrincipal) {
        throw new Error('funded recovery left declared principal unexplained');
      }
      const observedRecoveryFees =
        restored.sendFee +
        restored.receiveFee +
        returnedTokens.reduce(
          (sum, entry) => sum + (entry.tokenAmount - entry.counterpartyDelta),
          0
        );
      if (fees !== observedRecoveryFees) {
        throw new Error('funded recovery fee total was not independently observed');
      }
      sweepResults.set(id, {
        ok: true,
        recoveredAmount,
        residualAmount: 0,
        fees,
      });
    }
    this.#report = report;
    this.#sweepResults = sweepResults;
  }

  async #reconcileHost(): Promise<void> {
    if (this.#reconciled) return;
    if (!this.#recovery) {
      if (this.#legs.size > 0) throw new Error('funded liabilities exist without seed custody');
      this.#accounting.finalize(new Map());
      this.#reconciled = true;
      return;
    }
    await this.#ensureRecoveryReport();
    for (const asset of this.#assets) {
      const id = assetIdentity(asset);
      const current = this.#legs.get(id);
      if (!current) continue;
      if (current.state !== 'funded') {
        throw new Error(`funded liability ${current.legId} cannot be swept from ${current.state}`);
      }
      const result = this.#sweepResults.get(id);
      if (!result) throw new Error('funded recovery produced no exact sweep result');
      await this.#stage(
        'sweep',
        asset,
        async () => result,
        async () => {
          const swept = await this.#coordinator.sweep(current);
          this.#legs.set(id, swept);
        }
      );
      const swept = this.#legs.get(id);
      if (!swept || swept.state !== 'swept') throw new Error('funded sweep was not durable');
      const reconciled = this.#coordinator.reconcile(swept);
      this.#legs.set(id, reconciled);
    }
    const finalBalances = new Map<string, number>();
    for (const asset of this.#assets) {
      finalBalances.set(assetIdentity(asset), await this.#exactBalance(asset));
    }
    this.#accounting.finalize(finalBalances);
    if (this.#custodyHandle) {
      deleteRecovery(join(this.#runDir, 'funded-liability'), this.#custodyHandle);
    }
    this.#recovery.disposePrivateMaterial();
    this.#mnemonic = undefined;
    this.#reconciled = true;
  }

  async #refreshAfterSweep(): Promise<void> {
    if (!this.#refreshedAfterSweep && this.#refreshApp) {
      await this.#refreshApp();
      this.#refreshedAfterSweep = true;
    }
  }

  async #exactBalance(asset: DeclaredRecoveryAsset): Promise<number> {
    if ((await this.#cocod.status()) !== 'UNLOCKED') {
      throw new Error('cocod must remain UNLOCKED for funded reconciliation');
    }
    const snapshot = await this.#cocod.balanceSnapshot();
    return this.#cocod.exactBalance(snapshot, asset);
  }

  #persistCashuOutflow(
    asset: DeclaredRecoveryAsset,
    amount: number,
    token: string,
    beforeBalance: number
  ): CashuOutflowRecord {
    const dir = join(this.#runDir, 'funded-runtime', 'cashu-outflows');
    ensurePrivateDirectory(dir);
    const tokenFingerprint = fingerprint(token);
    const record: CashuOutflowRecord = {
      version: 1,
      id: tokenFingerprint.slice(0, 16),
      phase: 'prepared',
      asset,
      amount,
      tokenFingerprint,
      token,
      beforeBalance,
    };
    durableReplaceFile(join(dir, `${record.id}.json`), JSON.stringify(record), 0o600);
    return record;
  }

  #completeCashuOutflow(
    record: CashuOutflowRecord,
    afterBalance: number,
    counterpartyDelta: number
  ): void {
    const completed: CashuOutflowRecord = {
      ...record,
      phase: 'received',
      afterBalance,
      counterpartyDelta,
    };
    delete completed.token;
    durableReplaceFile(
      join(this.#runDir, 'funded-runtime', 'cashu-outflows', `${record.id}.json`),
      JSON.stringify(completed),
      0o600
    );
  }
}

export function createFundedScenarioRuntime(
  options: FundedScenarioRuntimeOptions
): FundedScenarioRuntime {
  return new FundedScenarioRuntime(options);
}
