import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import {
  PaymentRequest,
  PaymentRequestTransportType,
  getEncodedToken,
} from '@cashu/cashu-ts';
import * as nip19 from 'nostr-tools/nip19';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';

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

  it('pays a NUT-18 request by minting the principal and gift-wrapping it to the nostr target', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(200);
    const asset = { ...ASSET, maxPrincipal: 50 };
    const receiverPubkey = getPublicKey(generateSecretKey());
    const encodedRequest = new PaymentRequest(
      [
        {
          type: PaymentRequestTransportType.NOSTR,
          target: nip19.nprofileEncode({ pubkey: receiverPubkey, relays: ['wss://r.example'] }),
          tags: [['n', '17']],
        },
      ],
      'req-runtime-1',
      undefined,
      'sat',
      [asset.mintUrl]
    ).toEncodedRequest();
    const deliveries: { payloadJson: string; receiverPubkey: string; relays: string[] }[] = [];
    const runtime = createFundedScenarioRuntime({
      runDir,
      runId: 'run-creq-pay',
      assets: [asset],
      cocod: wallet.cocod,
      resolveLightningAddress: async () => `lnbc${'2'.repeat(40)}`,
      deliverPaymentRequest: async (params) => {
        deliveries.push(params);
        return { wrapEventId: 'e'.repeat(64), acceptedBy: params.relays[0]! };
      },
      recoveryFactory: () => ({
        custodyPath: join(runDir, 'funded-custody', 'recovery.json'),
        assets: [asset],
        createCounterpartyCashu: async ({ amount }) => {
          wallet.add(-amount);
          return {
            token: getEncodedToken({
              mint: asset.mintUrl,
              unit: asset.unit,
              proofs: [
                {
                  amount,
                  id: '009a1f293253e41e',
                  secret: 's'.repeat(32),
                  C: `02${'a'.repeat(64)}`,
                },
              ] as never,
            }),
            amount,
          };
        },
        reconcile: async () => {
          wallet.add(50);
          return optionsReport(asset);
        },
        disposePrivateMaterial: () => {},
      }),
    });
    runtime.captureMnemonic(MNEMONIC);

    await expect(
      runtime.execute({
        action: 'counterparty',
        operation: 'paymentRequest.pay',
        mintUrl: 'https://other-mint.example',
        unit: asset.unit,
        accountIndex: asset.accountIndex,
        amount: 50,
        request: encodedRequest,
      })
    ).rejects.toThrow('paymentRequest.pay requested an undeclared funded asset');

    await runtime.execute({
      action: 'counterparty',
      operation: 'paymentRequest.pay',
      ...asset,
      amount: 50,
      request: encodedRequest,
    });
    expect(wallet.balance).toBe(150);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.receiverPubkey).toBe(receiverPubkey);
    expect(deliveries[0]!.relays).toEqual(['wss://r.example']);
    const payload = JSON.parse(deliveries[0]!.payloadJson) as {
      id: string;
      mint: string;
      unit: string;
      proofs: { amount: number }[];
      memo?: string;
    };
    expect(payload.id).toBe('req-runtime-1');
    expect(payload.mint).toBe(asset.mintUrl);
    expect(payload.unit).toBe('sat');
    expect(payload.proofs.map((proof) => proof.amount)).toEqual([50]);
    expect(payload.memo).toBe('[E2E] payment request');

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

  it('explains a declared inter-mint transfer within its fee budget and reconciles both legs', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const source: DeclaredRecoveryAsset = {
      mintUrl: 'https://mint.minibits.cash/Bitcoin',
      unit: 'sat',
      accountIndex: 0,
      maxPrincipal: 50,
    };
    const destination: DeclaredRecoveryAsset = {
      mintUrl: 'https://mint.sovran.money',
      unit: 'sat',
      accountIndex: 0,
      maxPrincipal: 50,
    };
    const balancesByMint: Record<string, number> = {
      [source.mintUrl]: 500,
      [destination.mintUrl]: 500,
    };
    const cocod: CocodCounterparty = {
      status: async () => 'UNLOCKED',
      balanceSnapshot: async () =>
        Object.fromEntries(
          Object.entries(balancesByMint).map(([mintUrl, sat]) => [mintUrl, { sat }])
        ) satisfies CocodBalanceSnapshot,
      exactBalance: (snapshot, asset) => snapshot[asset.mintUrl]?.[asset.unit] ?? 0,
      createCashu: async () => {
        throw new Error('not used');
      },
      receiveCashu: async () => {
        throw new Error('not used');
      },
      createBolt11: async () => {
        throw new Error('not used');
      },
      payBolt11: async (asset, _invoice, amount) => {
        balancesByMint[asset.mintUrl] -= amount;
        return { paid: true, amount };
      },
      npcAddress: async () => {
        throw new Error('not used');
      },
    };
    // The app rebalanced 45 sats from the source mint to the destination for a
    // 2-sat fee, so the sweep restores 95 at the destination and 3 at the source.
    const report: FundedRecoveryReport = {
      assets: [
        {
          asset: source,
          restoredAmount: 3,
          tokenAmount: 3,
          counterpartyDelta: 3,
          sendFee: 0,
          receiveFee: 0,
          residualAmount: 0,
        },
        {
          asset: destination,
          restoredAmount: 95,
          tokenAmount: 95,
          counterpartyDelta: 95,
          sendFee: 0,
          receiveFee: 0,
          residualAmount: 0,
        },
      ],
      counterpartyTokens: [],
    };
    let disposed = false;
    const runtime = createFundedScenarioRuntime({
      runDir,
      runId: 'run-transfer',
      assets: [source, destination],
      transfers: [
        {
          fromMintUrl: source.mintUrl,
          toMintUrl: destination.mintUrl,
          unit: 'sat',
          accountIndex: 0,
          maxFeeSats: 10,
        },
      ],
      cocod,
      resolveLightningAddress: async () => `lnbc${'2'.repeat(40)}`,
      decodeBolt11Amount: () => 50,
      recoveryFactory: (input) => {
        expect(input.transfers).toEqual([
          expect.objectContaining({ fromMintUrl: source.mintUrl, maxFeeSats: 10 }),
        ]);
        return {
          custodyPath: join(runDir, 'funded-custody', 'recovery.json'),
          assets: [source, destination],
          createCounterpartyCashu: async () => {
            throw new Error('not used');
          },
          reconcile: async ({ acceptEmptyAssets }) => {
            // The declared transfer source may legitimately scan empty.
            expect(acceptEmptyAssets).toEqual([source]);
            balancesByMint[source.mintUrl] += 3;
            balancesByMint[destination.mintUrl] += 95;
            return report;
          },
          disposePrivateMaterial: () => {
            disposed = true;
          },
        };
      },
    });
    runtime.captureMnemonic(MNEMONIC);
    for (const asset of [source, destination]) {
      await runtime.execute({
        action: 'counterparty',
        operation: 'bolt11.pay',
        mintUrl: asset.mintUrl,
        unit: asset.unit,
        accountIndex: asset.accountIndex,
        amount: 50,
        invoice: secret('bolt11', `lnbc${'3'.repeat(40)}`) as unknown as string,
      });
    }

    await runtime.execute({
      action: 'counterparty',
      operation: 'recovery.sweep',
      mintUrl: destination.mintUrl,
      unit: destination.unit,
      accountIndex: destination.accountIndex,
    });

    expect(disposed).toBe(true);
    expect(balancesByMint[source.mintUrl]).toBe(453);
    expect(balancesByMint[destination.mintUrl]).toBe(545);
    const ledger = new RunLedger(join(runDir, 'funded-liability'), 'run-transfer');
    expect([...ledger.status().values()]).toEqual(['reconciled', 'reconciled']);
    const entries = ledger.read();
    expect(entries).toContainEqual(
      expect.objectContaining({ kind: 'transfer-out', legId: 'asset-01', amount: 45, fees: 2 })
    );
    expect(entries).toContainEqual(
      expect.objectContaining({ kind: 'transfer-in', legId: 'asset-02', amount: 45 })
    );
    expect(auditStartupLiabilities(runDir)).toEqual({ status: 'clean', blockers: [] });
  });

  it('refuses to reconcile when a declared transfer exceeds its fee budget', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const source: DeclaredRecoveryAsset = {
      mintUrl: 'https://mint.minibits.cash/Bitcoin',
      unit: 'sat',
      accountIndex: 0,
      maxPrincipal: 50,
    };
    const destination: DeclaredRecoveryAsset = {
      mintUrl: 'https://mint.sovran.money',
      unit: 'sat',
      accountIndex: 0,
      maxPrincipal: 50,
    };
    const balancesByMint: Record<string, number> = {
      [source.mintUrl]: 500,
      [destination.mintUrl]: 500,
    };
    const cocod: CocodCounterparty = {
      status: async () => 'UNLOCKED',
      balanceSnapshot: async () =>
        Object.fromEntries(
          Object.entries(balancesByMint).map(([mintUrl, sat]) => [mintUrl, { sat }])
        ) satisfies CocodBalanceSnapshot,
      exactBalance: (snapshot, asset) => snapshot[asset.mintUrl]?.[asset.unit] ?? 0,
      createCashu: async () => {
        throw new Error('not used');
      },
      receiveCashu: async () => {
        throw new Error('not used');
      },
      createBolt11: async () => {
        throw new Error('not used');
      },
      payBolt11: async (asset, _invoice, amount) => {
        balancesByMint[asset.mintUrl] -= amount;
        return { paid: true, amount };
      },
      npcAddress: async () => {
        throw new Error('not used');
      },
    };
    const runtime = createFundedScenarioRuntime({
      runDir,
      runId: 'run-transfer-overfee',
      assets: [source, destination],
      transfers: [
        {
          fromMintUrl: source.mintUrl,
          toMintUrl: destination.mintUrl,
          unit: 'sat',
          accountIndex: 0,
          maxFeeSats: 1,
        },
      ],
      cocod,
      resolveLightningAddress: async () => `lnbc${'2'.repeat(40)}`,
      decodeBolt11Amount: () => 50,
      recoveryFactory: () => ({
        custodyPath: join(runDir, 'funded-custody', 'recovery.json'),
        assets: [source, destination],
        createCounterpartyCashu: async () => {
          throw new Error('not used');
        },
        reconcile: async () => ({
          assets: [
            {
              asset: source,
              restoredAmount: 3,
              tokenAmount: 3,
              counterpartyDelta: 3,
              sendFee: 0,
              receiveFee: 0,
              residualAmount: 0,
            },
            {
              asset: destination,
              restoredAmount: 95,
              tokenAmount: 95,
              counterpartyDelta: 95,
              sendFee: 0,
              receiveFee: 0,
              residualAmount: 0,
            },
          ],
          counterpartyTokens: [],
        }),
        disposePrivateMaterial: () => {},
      }),
    });
    runtime.captureMnemonic(MNEMONIC);
    for (const asset of [source, destination]) {
      await runtime.execute({
        action: 'counterparty',
        operation: 'bolt11.pay',
        mintUrl: asset.mintUrl,
        unit: asset.unit,
        accountIndex: asset.accountIndex,
        amount: 50,
        invoice: secret('bolt11', `lnbc${'3'.repeat(40)}`) as unknown as string,
      });
    }

    await expect(runtime.reconcile()).rejects.toThrow(/exceeded its fee budget/);
    const ledger = new RunLedger(join(runDir, 'funded-liability'), 'run-transfer-overfee');
    expect([...ledger.status().values()].every((status) => status === 'funded')).toBe(true);
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

  it('returns the cocod npc address as a typed secret without touching balances', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(500);
    const context = makeRuntime({
      runDir,
      cocod: wallet.cocod,
      report: { assets: [], counterpartyTokens: [] },
    });

    const result = await context.runtime.execute({
      action: 'counterparty',
      operation: 'npc.address',
      captureAs: 'addr',
    });

    expect(result.output?.kind).toBe('lightning-address');
    expect(result.output?.reveal()).toBe('test@npubx.cash');
    // Read-only: no asset validation, no accounting, no balance movement.
    expect(wallet.balance).toBe(500);
    expect(readdirSync(join(runDir, 'funded-liability'))).toEqual([]);
  });

  it('records an npc outflow on app-side evidence without moving cocod value', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(500);
    const context = makeRuntime({
      runDir,
      cocod: wallet.cocod,
      // The app melted 40 to npubx.cash and kept 60; the sweep restores the 60.
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
      operation: 'npc.outflow',
      ...ASSET,
      amount: 40,
      address: secret('lightning-address', 'npub1recipient@npubx.cash') as unknown as string,
    });
    // cocod never sees npubx.cash funds — its balance is untouched by the op.
    expect(wallet.balance).toBe(400);
    await context.runtime.reconcile();
    expect(wallet.balance).toBe(460);
    const entries = new RunLedger(join(runDir, 'funded-liability'), 'run-1').read();
    expect(entries.find((entry) => entry.kind === 'outflow')).toMatchObject({
      amount: 40,
      fees: 0,
      counterparty: 'npc:npub1recipient@npubx.cash',
      txId: expect.stringMatching(/^npc-[0-9a-f]{16}$/),
    });
  });

  it('attributes a bounded sender-side melt fee via npc.outflow maxFeeSats', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(500);
    const context = makeRuntime({
      runDir,
      cocod: wallet.cocod,
      // The app melted 40 to npubx.cash and the melt cost 1 sat, so 59 remain.
      onReconcile: () => wallet.add(59),
      report: {
        assets: [
          {
            asset: ASSET,
            restoredAmount: 59,
            tokenAmount: 59,
            counterpartyDelta: 59,
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
      operation: 'npc.outflow',
      ...ASSET,
      amount: 40,
      maxFeeSats: 3,
      address: secret('lightning-address', 'npub1recipient@npubx.cash') as unknown as string,
    });
    await context.runtime.reconcile();
    expect(wallet.balance).toBe(459);
  });

  it('quarantines when the npc outflow melt fee exceeds maxFeeSats', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(500);
    const context = makeRuntime({
      runDir,
      cocod: wallet.cocod,
      // 5 sats of principal vanished but the budget only covers 3.
      onReconcile: () => wallet.add(55),
      report: {
        assets: [
          {
            asset: ASSET,
            restoredAmount: 55,
            tokenAmount: 55,
            counterpartyDelta: 55,
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
      operation: 'npc.outflow',
      ...ASSET,
      amount: 40,
      maxFeeSats: 3,
      address: secret('lightning-address', 'npub1recipient@npubx.cash') as unknown as string,
    });
    await expect(context.runtime.reconcile()).rejects.toThrow(/unexplained/);
  });

  it('rejects an npc outflow when cocod-side value unexpectedly moves', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'sovran-funded-runtime-'));
    const wallet = fakeCocod(500);
    const context = makeRuntime({
      runDir,
      cocod: wallet.cocod,
      report: { assets: [], counterpartyTokens: [] },
    });
    await context.runtime.execute({
      action: 'counterparty',
      operation: 'bolt11.pay',
      ...ASSET,
      amount: 100,
      invoice: secret('bolt11', `lnbc${'3'.repeat(40)}`) as unknown as string,
    });
    const original = wallet.cocod.balanceSnapshot;
    let reads = 0;
    wallet.cocod.balanceSnapshot = async () => {
      reads++;
      // Drift between the pre-check and the staged effect's re-read.
      if (reads > 1) wallet.add(1);
      return original();
    };
    await expect(
      context.runtime.execute({
        action: 'counterparty',
        operation: 'npc.outflow',
        ...ASSET,
        amount: 40,
        address: secret('lightning-address', 'npub1recipient@npubx.cash') as unknown as string,
      })
    ).rejects.toThrow(/unexpectedly moved cocod-side value|uncertain/);
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
