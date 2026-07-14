import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { secret } from '../core/redact';
import type {
  CocodBalanceSnapshot,
  CocodCounterparty,
  DeclaredRecoveryAsset,
  FundedRecoveryReport,
} from '../funded';
import { RunLedger } from '../ledger/ledger';
import { auditStartupLiabilities } from '../ledger/startup';
import { createFundedScenarioRuntime } from './runtime';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ASSET: DeclaredRecoveryAsset = {
  mintUrl: 'https://mint.example',
  unit: 'sat',
  accountIndex: 0,
  maxPrincipal: 100,
};

function fakeCocod(initialBalance: number) {
  let balance = initialBalance;
  let payBolt11Calls = 0;
  let receiveCashuCalls = 0;
  const cocod: CocodCounterparty = {
    status: async () => 'UNLOCKED',
    balanceSnapshot: async () =>
      ({ [ASSET.mintUrl]: { sat: balance } }) satisfies CocodBalanceSnapshot,
    exactBalance: (snapshot, asset) => snapshot[asset.mintUrl]?.[asset.unit] ?? 0,
    createCashu: async (_asset, amount) => {
      balance -= amount;
      return { token: `cashuA${'x'.repeat(30)}`, amount };
    },
    receiveCashu: async () => {
      receiveCashuCalls++;
      return { reportedAmount: 40 };
    },
    createBolt11: async (_asset, amount) => ({ invoice: `lnbc${'1'.repeat(40)}`, amount }),
    payBolt11: async (_asset, _invoice, amount) => {
      payBolt11Calls++;
      balance -= amount;
      return { paid: true, amount };
    },
    npcAddress: async () => 'test@npubx.cash',
  };
  return {
    cocod,
    get balance() {
      return balance;
    },
    get payBolt11Calls() {
      return payBolt11Calls;
    },
    get receiveCashuCalls() {
      return receiveCashuCalls;
    },
    add(amount: number) {
      balance += amount;
    },
    receiveCashu(amount: number) {
      cocod.receiveCashu = async () => {
        receiveCashuCalls++;
        balance += amount;
        return { reportedAmount: amount };
      };
    },
  };
}

function makeRuntime(options: {
  runDir: string;
  cocod: CocodCounterparty;
  report: FundedRecoveryReport | (() => FundedRecoveryReport);
  onReconcile?: () => void;
  createCounterpartyCashu?: (amount: number) => Promise<{ token: string; amount: number }>;
  inspectCashuToken?: () => Promise<{
    totalAmount: number;
    unspentAmount: number;
    pendingAmount: number;
    spentAmount: number;
  }>;
  decodeBolt11Amount?: (invoice: string) => number | null;
  refreshApp?: () => Promise<void>;
}) {
  let disposed = false;
  let refreshed = 0;
  const runtime = createFundedScenarioRuntime({
    runDir: options.runDir,
    runId: 'run-1',
    assets: [ASSET],
    cocod: options.cocod,
    resolveLightningAddress: async () => `lnbc${'2'.repeat(40)}`,
    decodeBolt11Amount: options.decodeBolt11Amount ?? (() => 100),
    refreshApp:
      options.refreshApp ??
      (async () => {
        refreshed++;
      }),
    recoveryFactory: () => ({
      custodyPath: join(options.runDir, 'funded-custody', 'recovery.json'),
      assets: [ASSET],
      createCounterpartyCashu: async ({ amount }) =>
        options.createCounterpartyCashu?.(amount) ?? {
          token: `cashuA${'x'.repeat(30)}`,
          amount,
        },
      inspectCashuToken:
        options.inspectCashuToken ??
        (async () => ({
          totalAmount: 40,
          unspentAmount: 40,
          pendingAmount: 0,
          spentAmount: 0,
        })),
      reconcile: async () => {
        options.onReconcile?.();
        return typeof options.report === 'function' ? options.report() : options.report;
      },
      disposePrivateMaterial: () => {
        disposed = true;
      },
    }),
  });
  runtime.captureMnemonic(MNEMONIC);
  return {
    runtime,
    get disposed() {
      return disposed;
    },
    get refreshed() {
      return refreshed;
    },
  };
}

describe('funded scenario runtime', () => {
  it('funds, persists a Cashu outflow before redemption, sweeps, and reconciles exactly', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(500);
    wallet.receiveCashu(40);
    const context = makeRuntime({
      runDir,
      cocod: wallet.cocod,
      onReconcile: () => wallet.add(60),
      report: {
        assets: [
          {
            asset: ASSET,
            restoredAmount: 60,
            tokenAmount: 60,
            counterpartyDelta: 60,
            sendFee: 0,
            receiveFee: 0,
            residualAmount: 0,
          },
        ],
        counterpartyTokens: [],
      },
    });

    await context.runtime.execute({
      action: 'counterparty',
      operation: 'bolt11.pay',
      ...ASSET,
      amount: 100,
      invoice: secret('bolt11', `lnbc${'3'.repeat(40)}`) as unknown as string,
    });
    await context.runtime.execute({
      action: 'counterparty',
      operation: 'cashu.redeem',
      ...ASSET,
      amount: 40,
      token: secret('cashu-token', `cashuA${'y'.repeat(30)}`) as unknown as string,
    });
    const outflowDir = join(runDir, 'funded-runtime', 'cashu-outflows');
    const outflowPath = join(outflowDir, readdirSync(outflowDir)[0]);
    expect(statSync(outflowPath).mode & 0o077).toBe(0);
    expect(readFileSync(outflowPath, 'utf8')).not.toContain(`cashuA${'y'.repeat(30)}`);

    await context.runtime.execute({
      action: 'counterparty',
      operation: 'recovery.sweep',
      mintUrl: ASSET.mintUrl,
      unit: ASSET.unit,
      accountIndex: ASSET.accountIndex,
    });

    expect(wallet.balance).toBe(500);
    expect(context.disposed).toBe(true);
    expect(context.refreshed).toBe(1);
    expect(() => context.runtime.captureMnemonic(MNEMONIC)).not.toThrow();
    expect(() => context.runtime.captureMnemonic(MNEMONIC.replace(/about$/, 'zoo'))).toThrow(
      /more than one wallet mnemonic/
    );
    const ledger = new RunLedger(join(runDir, 'funded-liability'), 'run-1');
    expect([...ledger.status().values()]).toEqual(['reconciled']);
    expect(auditStartupLiabilities(runDir)).toEqual({ status: 'clean', blockers: [] });
    const accounting = JSON.parse(
      readFileSync(join(runDir, 'funded-runtime', 'cocod-accounting.json'), 'utf8')
    );
    expect(accounting.final).toBe(true);
    expect(accounting.observations.map(({ delta }: { delta: number }) => delta)).toEqual([
      -100, 40, 60,
    ]);
  });

  it('returns an unspent counterparty token and accounts its principal once', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(200);
    const asset = { ...ASSET, maxPrincipal: 50 };
    const runtime = createFundedScenarioRuntime({
      runDir,
      runId: 'run-return',
      assets: [asset],
      cocod: wallet.cocod,
      resolveLightningAddress: async () => `lnbc${'2'.repeat(40)}`,
      recoveryFactory: () => ({
        custodyPath: join(runDir, 'funded-custody', 'recovery.json'),
        assets: [asset],
        createCounterpartyCashu: async ({ amount }) => {
          wallet.add(-amount);
          return { token: `cashuA${'z'.repeat(30)}`, amount };
        },
        reconcile: async () => {
          wallet.add(50);
          return optionsReport(asset);
        },
        disposePrivateMaterial: () => {},
      }),
    });
    runtime.captureMnemonic(MNEMONIC);
    const created = await runtime.execute({
      action: 'counterparty',
      operation: 'cashu.create',
      ...asset,
      amount: 50,
      captureAs: 'token',
    });
    expect(created.output?.kind).toBe('cashu-token');
    await runtime.execute({
      action: 'counterparty',
      operation: 'recovery.sweep',
      mintUrl: asset.mintUrl,
      unit: asset.unit,
      accountIndex: asset.accountIndex,
    });
    expect(wallet.balance).toBe(200);
  });

  it('observes an app-paid BOLT11 before recording the exact outflow', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(500);
    const context = makeRuntime({
      runDir,
      cocod: wallet.cocod,
      onReconcile: () => wallet.add(60),
      report: {
        assets: [
          {
            asset: ASSET,
            restoredAmount: 60,
            tokenAmount: 60,
            counterpartyDelta: 60,
            sendFee: 0,
            receiveFee: 0,
            residualAmount: 0,
          },
        ],
        counterpartyTokens: [],
      },
    });
    await context.runtime.execute({
      action: 'counterparty',
      operation: 'bolt11.pay',
      ...ASSET,
      amount: 100,
      invoice: secret('bolt11', `lnbc${'3'.repeat(40)}`) as unknown as string,
    });
    const created = await context.runtime.execute({
      action: 'counterparty',
      operation: 'bolt11.create',
      ...ASSET,
      amount: 40,
      captureAs: 'invoice',
    });
    wallet.add(40);
    await context.runtime.execute({
      action: 'counterparty',
      operation: 'bolt11.settled',
      ...ASSET,
      amount: 40,
      invoice: created.output as unknown as string,
    });
    await context.runtime.reconcile();
    expect(wallet.balance).toBe(500);
    const entries = new RunLedger(join(runDir, 'funded-liability'), 'run-1').read();
    expect(entries.find((entry) => entry.kind === 'outflow')).toMatchObject({
      amount: 40,
      txId: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
  });

  it('preserves custody instead of calling an unexplained principal gap a fee', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(500);
    const context = makeRuntime({
      runDir,
      cocod: wallet.cocod,
      report: {
        assets: [
          {
            asset: ASSET,
            restoredAmount: 0,
            tokenAmount: 0,
            counterpartyDelta: 0,
            sendFee: 0,
            receiveFee: 0,
            residualAmount: 0,
          },
        ],
        counterpartyTokens: [],
      },
    });
    await context.runtime.execute({
      action: 'counterparty',
      operation: 'bolt11.pay',
      ...ASSET,
      amount: 100,
      invoice: secret('bolt11', `lnbc${'3'.repeat(40)}`) as unknown as string,
    });

    await expect(context.runtime.reconcile()).rejects.toThrow(/principal unexplained/);
    expect(context.disposed).toBe(false);
    expect(
      readdirSync(join(runDir, 'funded-liability', 'custody')).some((name) =>
        name.endsWith('.secret')
      )
    ).toBe(true);
  });

  it('re-probes a retryable empty scan instead of caching the issuance delay', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(500);
    let recoveryAttempts = 0;
    const context = makeRuntime({
      runDir,
      cocod: wallet.cocod,
      onReconcile: () => {
        recoveryAttempts++;
        if (recoveryAttempts === 2) wallet.add(100);
      },
      report: () => ({
        assets: [
          recoveryAttempts === 1
            ? {
                asset: ASSET,
                restoredAmount: 0,
                tokenAmount: 0,
                counterpartyDelta: 0,
                sendFee: 0,
                receiveFee: 0,
                residualAmount: 0,
              }
            : {
                asset: ASSET,
                restoredAmount: 100,
                tokenAmount: 100,
                counterpartyDelta: 100,
                sendFee: 0,
                receiveFee: 0,
                residualAmount: 0,
              },
        ],
        counterpartyTokens: [],
      }),
    });
    await context.runtime.execute({
      action: 'counterparty',
      operation: 'bolt11.pay',
      ...ASSET,
      amount: 100,
      invoice: secret('bolt11', `lnbc${'3'.repeat(40)}`) as unknown as string,
    });

    await expect(context.runtime.reconcile()).rejects.toThrow(/principal unexplained/);
    await expect(context.runtime.reconcile()).resolves.toBe('reconciled');
    expect(recoveryAttempts).toBe(2);
    expect(context.disposed).toBe(true);
  });

  it('retries app refresh after funds are already safely reconciled', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(500);
    let refreshAttempts = 0;
    const context = makeRuntime({
      runDir,
      cocod: wallet.cocod,
      onReconcile: () => wallet.add(100),
      refreshApp: async () => {
        refreshAttempts++;
        if (refreshAttempts === 1) throw new Error('simulator refresh failed');
      },
      report: {
        assets: [
          {
            asset: ASSET,
            restoredAmount: 100,
            tokenAmount: 100,
            counterpartyDelta: 100,
            sendFee: 0,
            receiveFee: 0,
            residualAmount: 0,
          },
        ],
        counterpartyTokens: [],
      },
    });
    await context.runtime.execute({
      action: 'counterparty',
      operation: 'bolt11.pay',
      ...ASSET,
      amount: 100,
      invoice: secret('bolt11', `lnbc${'3'.repeat(40)}`) as unknown as string,
    });

    const sweep = {
      action: 'counterparty' as const,
      operation: 'recovery.sweep' as const,
      ...ASSET,
    };
    await expect(context.runtime.execute(sweep)).rejects.toThrow(/refresh failed/);
    expect(context.runtime.fundsReconciled).toBe(true);
    await expect(context.runtime.reconcile()).resolves.toBe('reconciled');
    expect(refreshAttempts).toBe(1);
    await expect(context.runtime.execute(sweep)).resolves.toEqual({});
    expect(refreshAttempts).toBe(2);
  });

  it('terminalizes an empty asset when no funding intent or effect ever occurred', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(500);
    const context = makeRuntime({
      runDir,
      cocod: wallet.cocod,
      report: {
        assets: [
          {
            asset: ASSET,
            restoredAmount: 0,
            tokenAmount: 0,
            counterpartyDelta: 0,
            sendFee: 0,
            receiveFee: 0,
            residualAmount: 0,
          },
        ],
        counterpartyTokens: [],
      },
    });

    await expect(context.runtime.reconcile()).resolves.toBe('reconciled');
    expect(context.runtime.fundsReconciled).toBe(true);
    expect(context.disposed).toBe(true);
    expect(wallet.balance).toBe(500);
  });

  it('rejects raw payment material at the runtime boundary', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(100);
    const context = makeRuntime({
      runDir,
      cocod: wallet.cocod,
      report: { assets: [], counterpartyTokens: [] },
    });
    await expect(
      context.runtime.execute({
        action: 'counterparty',
        operation: 'bolt11.pay',
        ...ASSET,
        amount: 100,
        invoice: `lnbc${'4'.repeat(40)}`,
      })
    ).rejects.toThrow(/typed secret/);
    expect(readdirSync(join(runDir, 'funded-liability'))).toEqual([]);
  });

  it('rejects a mismatched BOLT11 amount before cocod can pay it', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(500);
    const context = makeRuntime({
      runDir,
      cocod: wallet.cocod,
      decodeBolt11Amount: () => 1_000,
      report: { assets: [], counterpartyTokens: [] },
    });

    await expect(
      context.runtime.execute({
        action: 'counterparty',
        operation: 'bolt11.pay',
        ...ASSET,
        amount: 100,
        invoice: secret('bolt11', `lnbc${'4'.repeat(40)}`) as unknown as string,
      })
    ).rejects.toThrow(/invoice amount/);
    expect(wallet.payBolt11Calls).toBe(0);
    expect(wallet.balance).toBe(500);
  });

  it('rejects a wrong Cashu token before cocod can redeem it', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(500);
    const context = makeRuntime({
      runDir,
      cocod: wallet.cocod,
      inspectCashuToken: async () => ({
        totalAmount: 41,
        unspentAmount: 41,
        pendingAmount: 0,
        spentAmount: 0,
      }),
      report: { assets: [], counterpartyTokens: [] },
    });
    await context.runtime.execute({
      action: 'counterparty',
      operation: 'bolt11.pay',
      ...ASSET,
      amount: 100,
      invoice: secret('bolt11', `lnbc${'3'.repeat(40)}`) as unknown as string,
    });

    await expect(
      context.runtime.execute({
        action: 'counterparty',
        operation: 'cashu.redeem',
        ...ASSET,
        amount: 40,
        token: secret('cashu-token', `cashuA${'y'.repeat(30)}`) as unknown as string,
      })
    ).rejects.toThrow(/pre-redemption validation/);
    expect(wallet.receiveCashuCalls).toBe(0);
  });
});

function optionsReport(asset: DeclaredRecoveryAsset): FundedRecoveryReport {
  return {
    assets: [
      {
        asset,
        restoredAmount: 0,
        tokenAmount: 0,
        counterpartyDelta: 0,
        sendFee: 0,
        receiveFee: 0,
        residualAmount: 0,
      },
    ],
    counterpartyTokens: [
      {
        asset,
        tokenAmount: 50,
        counterpartyDelta: 50,
        fee: 0,
        disposition: 'returned',
      },
    ],
  };
}
