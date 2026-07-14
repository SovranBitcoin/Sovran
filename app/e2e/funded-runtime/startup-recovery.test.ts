import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import type {
  CocodBalanceSnapshot,
  CocodCounterparty,
  DeclaredRecoveryAsset,
  FundedRecoveryReport,
} from '../funded';
import { storeRecovery } from '../ledger/custody';
import { RunLedger } from '../ledger/ledger';
import {
  auditFundedRecoverySessions,
  recoverStaleFundedSessions,
  scanFundedRecoverySessions,
  type FundedRecoveryPort,
} from './startup-recovery';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ASSET: DeclaredRecoveryAsset = {
  mintUrl: 'https://mint.example',
  unit: 'sat',
  accountIndex: 0,
  maxPrincipal: 100,
};

function fakeCocod(
  options: {
    initialBalance?: number;
    receivedAmount?: number;
    reportedAmount?: number;
    onReceive?: () => void;
  } = {}
): CocodCounterparty {
  let balance = options.initialBalance ?? 0;
  return {
    status: async () => 'UNLOCKED',
    balanceSnapshot: async () => ({}) satisfies CocodBalanceSnapshot,
    exactBalance: () => balance,
    createCashu: async (_asset, amount) => ({ token: `cashuA${'x'.repeat(30)}`, amount }),
    receiveCashu: async () => {
      options.onReceive?.();
      balance += options.receivedAmount ?? 0;
      return { reportedAmount: options.reportedAmount ?? options.receivedAmount ?? 1 };
    },
    createBolt11: async (_asset, amount) => ({ invoice: `lnbc${'1'.repeat(40)}`, amount }),
    payBolt11: async (_asset, _invoice, amount) => ({ paid: true, amount }),
    npcAddress: async () => 'test@npubx.cash',
  };
}

const tokenFingerprint = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

function sessionFixture(name = 'one') {
  const artifactsRoot = mkdtempSync(join(tmpdir(), 'sovran-funded-startup-'));
  const runDir = join(artifactsRoot, `run-${name}`, 'session-0');
  const fundedCustodyDir = join(runDir, 'funded-custody');
  const liabilityDir = join(runDir, 'funded-liability');
  mkdirSync(fundedCustodyDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(fundedCustodyDir, 'recovery.json'), '{}', { mode: 0o600 });
  const custody = storeRecovery(liabilityDir, 'mnemonic', MNEMONIC);
  const ledger = new RunLedger(liabilityDir, `run-${name}`, () => 1);
  ledger.registerFunding({
    legId: 'asset-01',
    custody,
    counterparty: 'cocod-test-wallet',
    asset: {
      mintUrl: ASSET.mintUrl,
      unit: ASSET.unit,
      accountIndex: ASSET.accountIndex,
    },
    expectedAmount: ASSET.maxPrincipal,
  });
  const fixture = {
    artifactsRoot,
    runDir,
    fundedCustodyDir,
    liabilityDir,
    custody,
    ledger,
    runId: `run-${name}`,
  };
  writeAccounting(fixture, []);
  return fixture;
}

function writeAccounting(
  fixture: { runDir: string; runId: string },
  observations: {
    operation: string;
    before: number;
    after: number;
  }[],
  pendingInvoices: {
    amount: number;
    beforeBalance: number;
    settlementDeadlineMs: number;
  }[] = []
): void {
  const dir = join(fixture.runDir, 'funded-runtime');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const baseline = observations[0]?.before ?? 0;
  const current = observations.at(-1)?.after ?? baseline;
  writeFileSync(
    join(dir, 'cocod-accounting.json'),
    JSON.stringify({
      version: 1,
      runId: fixture.runId,
      assets: observations.length > 0 ? [{ asset: ASSET, baseline, current }] : [],
      observations: observations.map((observation, index) => ({
        sequence: index + 1,
        operation: observation.operation,
        asset: ASSET,
        before: observation.before,
        after: observation.after,
        delta: observation.after - observation.before,
      })),
      pendingInvoices: pendingInvoices.map((pending, index) => ({
        fingerprint: String(index + 1).padStart(64, '0'),
        asset: ASSET,
        ...pending,
      })),
      final: false,
    }),
    { mode: 0o600 }
  );
}

function writeReceivedCashuOutflow(
  fixture: { runDir: string },
  amount: number,
  beforeBalance: number,
  afterBalance: number
): string {
  const dir = join(fixture.runDir, 'funded-runtime', 'cashu-outflows');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tokenFingerprint = 'a'.repeat(64);
  writeFileSync(
    join(dir, `${tokenFingerprint.slice(0, 16)}.json`),
    JSON.stringify({
      version: 1,
      id: tokenFingerprint.slice(0, 16),
      phase: 'received',
      asset: ASSET,
      amount,
      tokenFingerprint,
      beforeBalance,
      afterBalance,
      counterpartyDelta: afterBalance - beforeBalance,
    }),
    { mode: 0o600 }
  );
  return tokenFingerprint.slice(0, 16);
}

function writePreparedCashuOutflow(
  fixture: { runDir: string },
  options: { token?: string; amount?: number; beforeBalance?: number; fingerprint?: string } = {}
): { path: string; token: string; fingerprint: string } {
  const dir = join(fixture.runDir, 'funded-runtime', 'cashu-outflows');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const token = options.token ?? `cashuA${'p'.repeat(40)}`;
  const fingerprint = options.fingerprint ?? tokenFingerprint(token);
  const path = join(dir, `${fingerprint.slice(0, 16)}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      id: fingerprint.slice(0, 16),
      phase: 'prepared',
      asset: ASSET,
      amount: options.amount ?? 40,
      tokenFingerprint: fingerprint,
      token,
      beforeBalance: options.beforeBalance ?? 400,
    }),
    { mode: 0o600 }
  );
  return { path, token, fingerprint };
}

const sixtyRestoredReport: FundedRecoveryReport = {
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
};

function fakeRecovery(options: {
  runDir: string;
  report?: FundedRecoveryReport;
  fail?: boolean;
  onDispose?: () => void;
  inspectCashuToken?: FundedRecoveryPort['inspectCashuToken'];
}): FundedRecoveryPort {
  const custodyPath = join(options.runDir, 'funded-custody', 'recovery.json');
  return {
    custodyPath,
    assets: [ASSET],
    inspectCashuToken:
      options.inspectCashuToken ??
      (async () => ({
        totalAmount: 40,
        unspentAmount: 40,
        pendingAmount: 0,
        spentAmount: 0,
      })),
    reconcile: async () => {
      if (options.fail) throw new Error(`do not leak ${MNEMONIC}`);
      return (
        options.report ?? {
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
        }
      );
    },
    disposePrivateMaterial: () => {
      options.onDispose?.();
      unlinkSync(custodyPath);
    },
  };
}

describe('funded startup recovery', () => {
  it('cancels an intent only after recovery proves zero principal and no counterparty token', async () => {
    const fixture = sessionFixture('zero-intent');
    let disposed = false;

    expect(
      auditFundedRecoverySessions(fixture.artifactsRoot, () =>
        fakeRecovery({ runDir: fixture.runDir })
      )
    ).toMatchObject({ status: 'recovery-required' });

    const result = await recoverStaleFundedSessions({
      artifactsRoot: fixture.artifactsRoot,
      cocod: fakeCocod(),
      openRecovery: () =>
        fakeRecovery({
          runDir: fixture.runDir,
          onDispose: () => {
            disposed = true;
          },
        }),
    });

    expect(result.status).toBe('clean');
    expect(result.recovered).toEqual([
      expect.objectContaining({ cancelledLegs: 1, reconciledLegs: 0 }),
    ]);
    expect(new RunLedger(fixture.liabilityDir, 'run-zero-intent').status().get('asset-01')).toBe(
      'cancelled'
    );
    expect(disposed).toBe(true);
    expect(existsSync(join(fixture.fundedCustodyDir, 'recovery.json'))).toBe(false);
    expect(readdirSync(join(fixture.liabilityDir, 'custody'))).toEqual([]);
  });

  it('reconciles a funded leg whose stranded principal was explicitly written off', async () => {
    const fixture = sessionFixture('written-off');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    fixture.ledger.writeOff('asset-01', {
      amount: 100,
      reason: 'paid mint quote unclaimable — quote id lost with ephemeral simulator',
    });
    writeAccounting(fixture, [{ operation: 'bolt11.pay', before: 500, after: 400 }]);

    await recoverStaleFundedSessions({
      artifactsRoot: fixture.artifactsRoot,
      cocod: fakeCocod(),
      openRecovery: () => fakeRecovery({ runDir: fixture.runDir }),
    });

    const ledger = new RunLedger(fixture.liabilityDir, 'run-written-off');
    expect(ledger.status().get('asset-01')).toBe('reconciled');
    expect(ledger.read().at(-1)).toEqual(
      expect.objectContaining({
        kind: 'reconciled',
        fundedAmount: 100,
        recoveredAmount: 0,
        outflowAmount: 0,
        writtenOffAmount: 100,
        fees: 0,
      })
    );
    expect(existsSync(join(fixture.fundedCustodyDir, 'recovery.json'))).toBe(false);
  });

  it('still fails closed when a write-off does not close the funded principal', async () => {
    const fixture = sessionFixture('partial-write-off');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    fixture.ledger.writeOff('asset-01', { amount: 60, reason: 'partial acceptance' });
    writeAccounting(fixture, [{ operation: 'bolt11.pay', before: 500, after: 400 }]);

    await expect(
      recoverStaleFundedSessions({
        artifactsRoot: fixture.artifactsRoot,
        cocod: fakeCocod(),
        openRecovery: () => fakeRecovery({ runDir: fixture.runDir }),
      })
    ).rejects.toThrow(/unexplained empty funded asset/);
    expect(
      new RunLedger(fixture.liabilityDir, 'run-partial-write-off').status().get('asset-01')
    ).toBe('funded');
    expect(existsSync(join(fixture.fundedCustodyDir, 'recovery.json'))).toBe(true);
  });

  it('sweeps a funded leg and records exact conservation from the recovery report', async () => {
    const fixture = sessionFixture('funded');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    const outflowId = writeReceivedCashuOutflow(fixture, 40, 400, 440);
    fixture.ledger.recordOutflow('asset-01', {
      amount: 40,
      fees: 0,
      counterparty: 'cocod-test-wallet',
      txId: outflowId,
    });
    writeAccounting(fixture, [
      { operation: 'bolt11.pay', before: 500, after: 400 },
      { operation: 'cashu.redeem', before: 400, after: 440 },
    ]);
    const report: FundedRecoveryReport = {
      assets: [
        {
          asset: ASSET,
          restoredAmount: 60,
          tokenAmount: 59,
          counterpartyDelta: 58,
          sendFee: 1,
          receiveFee: 1,
          residualAmount: 0,
        },
      ],
      counterpartyTokens: [],
    };

    await recoverStaleFundedSessions({
      artifactsRoot: fixture.artifactsRoot,
      cocod: fakeCocod(),
      openRecovery: () => fakeRecovery({ runDir: fixture.runDir, report }),
    });

    const ledger = new RunLedger(fixture.liabilityDir, 'run-funded');
    expect(ledger.status().get('asset-01')).toBe('reconciled');
    expect(ledger.read().filter(({ kind }) => kind === 'sweep')).toEqual([
      expect.objectContaining({
        recoveredAmount: 58,
        residualAmount: 0,
        fees: 2,
      }),
    ]);
    expect(ledger.read().at(-1)).toEqual(
      expect.objectContaining({
        kind: 'reconciled',
        fundedAmount: 100,
        recoveredAmount: 58,
        outflowAmount: 40,
        fees: 2,
      })
    );
  });

  it('retries a fully UNSPENT prepared Cashu outflow and repairs exact evidence', async () => {
    const fixture = sessionFixture('prepared-unspent');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    writeAccounting(fixture, [{ operation: 'bolt11.pay', before: 500, after: 400 }]);
    const prepared = writePreparedCashuOutflow(fixture);
    let receiveCalls = 0;

    await recoverStaleFundedSessions({
      artifactsRoot: fixture.artifactsRoot,
      cocod: fakeCocod({
        initialBalance: 400,
        receivedAmount: 40,
        reportedAmount: 40,
        onReceive: () => {
          receiveCalls++;
        },
      }),
      openRecovery: () =>
        fakeRecovery({
          runDir: fixture.runDir,
          report: sixtyRestoredReport,
          inspectCashuToken: async () => ({
            totalAmount: 40,
            unspentAmount: 40,
            pendingAmount: 0,
            spentAmount: 0,
          }),
        }),
    });

    const terminal = JSON.parse(readFileSync(prepared.path, 'utf8')) as Record<string, unknown>;
    expect(receiveCalls).toBe(1);
    expect(terminal).toMatchObject({
      phase: 'received',
      afterBalance: 440,
      counterpartyDelta: 40,
    });
    expect(terminal).not.toHaveProperty('token');
    expect(lstatSync(prepared.path).mode & 0o777).toBe(0o600);
    const accounting = JSON.parse(
      readFileSync(join(fixture.runDir, 'funded-runtime', 'cocod-accounting.json'), 'utf8')
    ) as { observations: { operation: string; delta: number }[] };
    expect(accounting.observations.filter(({ operation }) => operation === 'cashu.redeem')).toEqual(
      [expect.objectContaining({ delta: 40 })]
    );
    const outflowEntries = fixture.ledger
      .read()
      .filter((entry) => entry.kind === 'outflow' && entry.txId === terminal.id);
    expect(outflowEntries).toHaveLength(1);
    expect(outflowEntries[0]).toMatchObject({
      amount: 40,
      fees: 0,
      counterparty: 'cocod-test-wallet',
    });
  });

  it('repairs a SPENT prepared outflow that was already credited to cocod', async () => {
    const fixture = sessionFixture('prepared-spent-credited');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    writeAccounting(fixture, [{ operation: 'bolt11.pay', before: 500, after: 400 }]);
    const prepared = writePreparedCashuOutflow(fixture);
    let receiveCalls = 0;

    await recoverStaleFundedSessions({
      artifactsRoot: fixture.artifactsRoot,
      cocod: fakeCocod({
        initialBalance: 440,
        onReceive: () => {
          receiveCalls++;
        },
      }),
      openRecovery: () =>
        fakeRecovery({
          runDir: fixture.runDir,
          report: sixtyRestoredReport,
          inspectCashuToken: async () => ({
            totalAmount: 40,
            unspentAmount: 0,
            pendingAmount: 0,
            spentAmount: 40,
          }),
        }),
    });

    const terminal = JSON.parse(readFileSync(prepared.path, 'utf8')) as Record<string, unknown>;
    expect(receiveCalls).toBe(0);
    expect(terminal).toMatchObject({
      phase: 'received',
      afterBalance: 440,
      counterpartyDelta: 40,
    });
    expect(terminal).not.toHaveProperty('token');
  });

  it('retains a SPENT zero-credit outflow without explicit fund-loss acceptance', async () => {
    const fixture = sessionFixture('prepared-spent-unaccepted');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    writeAccounting(fixture, [{ operation: 'bolt11.pay', before: 500, after: 400 }]);
    const prepared = writePreparedCashuOutflow(fixture);

    await expect(
      recoverStaleFundedSessions({
        artifactsRoot: fixture.artifactsRoot,
        cocod: fakeCocod({ initialBalance: 400 }),
        openRecovery: () =>
          fakeRecovery({
            runDir: fixture.runDir,
            report: sixtyRestoredReport,
            inspectCashuToken: async () => ({
              totalAmount: 40,
              unspentAmount: 0,
              pendingAmount: 0,
              spentAmount: 40,
            }),
          }),
      })
    ).rejects.toThrow(/fund-loss acceptance/);

    const retained = JSON.parse(readFileSync(prepared.path, 'utf8')) as Record<string, unknown>;
    expect(retained.phase).toBe('prepared');
    expect(retained).toHaveProperty('token');
    expect(lstatSync(prepared.path).mode & 0o777).toBe(0o600);
    expect(existsSync(join(fixture.fundedCustodyDir, 'recovery.json'))).toBe(true);
    expect(fixture.ledger.read().filter(({ kind }) => kind === 'outflow')).toEqual([]);
  });

  it('terminalizes a SPENT zero-credit outflow only with explicit fund-loss acceptance', async () => {
    const fixture = sessionFixture('prepared-spent-accepted');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    writeAccounting(fixture, [{ operation: 'bolt11.pay', before: 500, after: 400 }]);
    const prepared = writePreparedCashuOutflow(fixture);

    await recoverStaleFundedSessions({
      artifactsRoot: fixture.artifactsRoot,
      cocod: fakeCocod({ initialBalance: 400 }),
      acceptedTestFundLoss: true,
      openRecovery: () =>
        fakeRecovery({
          runDir: fixture.runDir,
          report: sixtyRestoredReport,
          inspectCashuToken: async () => ({
            totalAmount: 40,
            unspentAmount: 0,
            pendingAmount: 0,
            spentAmount: 40,
          }),
        }),
    });

    const terminal = JSON.parse(readFileSync(prepared.path, 'utf8')) as Record<string, unknown>;
    expect(terminal).toMatchObject({
      phase: 'spent-uncredited',
      afterBalance: 400,
      counterpartyDelta: 0,
      acceptedTestFundLoss: true,
    });
    expect(terminal).not.toHaveProperty('token');
    const accounting = JSON.parse(
      readFileSync(join(fixture.runDir, 'funded-runtime', 'cocod-accounting.json'), 'utf8')
    ) as { observations: { operation: string }[] };
    expect(accounting.observations.some(({ operation }) => operation === 'cashu.redeem')).toBe(
      false
    );
    const acceptedLossEntries = fixture.ledger
      .read()
      .filter((entry) => entry.kind === 'outflow' && entry.txId === terminal.id);
    expect(acceptedLossEntries).toHaveLength(1);
    expect(acceptedLossEntries[0]).toMatchObject({
      amount: 40,
      fees: 0,
      counterparty: 'accepted-crash-loss',
    });
  });

  for (const acceptedTestFundLoss of [false, true] as const) {
    it(`retains a SPENT partial-credit outflow ${
      acceptedTestFundLoss ? 'with' : 'without'
    } fund-loss acceptance`, async () => {
      const fixture = sessionFixture(
        `prepared-spent-partial-${acceptedTestFundLoss ? 'accepted' : 'unaccepted'}`
      );
      fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
      writeAccounting(fixture, [{ operation: 'bolt11.pay', before: 500, after: 400 }]);
      const prepared = writePreparedCashuOutflow(fixture);
      const originalEvidence = readFileSync(prepared.path, 'utf8');

      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(
          recoverStaleFundedSessions({
            artifactsRoot: fixture.artifactsRoot,
            cocod: fakeCocod({ initialBalance: 420 }),
            acceptedTestFundLoss,
            openRecovery: () =>
              fakeRecovery({
                runDir: fixture.runDir,
                report: sixtyRestoredReport,
                inspectCashuToken: async () => ({
                  totalAmount: 40,
                  unspentAmount: 0,
                  pendingAmount: 0,
                  spentAmount: 40,
                }),
              }),
          })
        ).rejects.toThrow(/balance drift/);
      }

      expect(readFileSync(prepared.path, 'utf8')).toBe(originalEvidence);
      expect(lstatSync(prepared.path).mode & 0o777).toBe(0o600);
      expect(existsSync(join(fixture.fundedCustodyDir, 'recovery.json'))).toBe(true);
      expect(fixture.ledger.read().filter(({ kind }) => kind === 'outflow')).toEqual([]);
      const accounting = JSON.parse(
        readFileSync(join(fixture.runDir, 'funded-runtime', 'cocod-accounting.json'), 'utf8')
      ) as { observations: { operation: string }[] };
      expect(accounting.observations.some(({ operation }) => operation === 'cashu.redeem')).toBe(
        false
      );
    });
  }

  for (const state of [
    {
      name: 'PENDING',
      balance: 400,
      inspected: { totalAmount: 40, unspentAmount: 0, pendingAmount: 40, spentAmount: 0 },
    },
    {
      name: 'mixed',
      balance: 400,
      inspected: { totalAmount: 40, unspentAmount: 20, pendingAmount: 0, spentAmount: 20 },
    },
    {
      name: 'cocod balance drift',
      balance: 401,
      inspected: { totalAmount: 40, unspentAmount: 40, pendingAmount: 0, spentAmount: 0 },
    },
    {
      name: 'SPENT excess cocod balance drift',
      balance: 441,
      inspected: { totalAmount: 40, unspentAmount: 0, pendingAmount: 0, spentAmount: 40 },
    },
    {
      name: 'SPENT negative cocod balance drift',
      balance: 399,
      inspected: { totalAmount: 40, unspentAmount: 0, pendingAmount: 0, spentAmount: 40 },
    },
  ] as const) {
    it(`fails closed and retains custody for ${state.name}`, async () => {
      const fixture = sessionFixture(`prepared-${state.name.replaceAll(' ', '-')}`);
      fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
      writeAccounting(fixture, [{ operation: 'bolt11.pay', before: 500, after: 400 }]);
      const prepared = writePreparedCashuOutflow(fixture);

      await expect(
        recoverStaleFundedSessions({
          artifactsRoot: fixture.artifactsRoot,
          cocod: fakeCocod({ initialBalance: state.balance }),
          acceptedTestFundLoss: true,
          openRecovery: () =>
            fakeRecovery({
              runDir: fixture.runDir,
              report: sixtyRestoredReport,
              inspectCashuToken: async () => state.inspected,
            }),
        })
      ).rejects.toThrow(/Cashu outflow/);

      const retained = JSON.parse(readFileSync(prepared.path, 'utf8')) as Record<string, unknown>;
      expect(retained.phase).toBe('prepared');
      expect(retained).toHaveProperty('token');
      expect(existsSync(join(fixture.fundedCustodyDir, 'recovery.json'))).toBe(true);
    });
  }

  it('rejects a prepared token whose full SHA-256 fingerprint does not match', async () => {
    const fixture = sessionFixture('prepared-fingerprint');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    writeAccounting(fixture, [{ operation: 'bolt11.pay', before: 500, after: 400 }]);
    const prepared = writePreparedCashuOutflow(fixture, { fingerprint: 'b'.repeat(64) });
    let inspected = false;

    await expect(
      recoverStaleFundedSessions({
        artifactsRoot: fixture.artifactsRoot,
        cocod: fakeCocod({ initialBalance: 400 }),
        acceptedTestFundLoss: true,
        openRecovery: () =>
          fakeRecovery({
            runDir: fixture.runDir,
            report: sixtyRestoredReport,
            inspectCashuToken: async () => {
              inspected = true;
              return { totalAmount: 40, unspentAmount: 40, pendingAmount: 0, spentAmount: 0 };
            },
          }),
      })
    ).rejects.toThrow(/validation/);

    expect(inspected).toBe(false);
    expect((JSON.parse(readFileSync(prepared.path, 'utf8')) as { phase: string }).phase).toBe(
      'prepared'
    );
    expect(existsSync(join(fixture.fundedCustodyDir, 'recovery.json'))).toBe(true);
  });

  it('repairs partially persisted credited evidence without duplicating it', async () => {
    const fixture = sessionFixture('prepared-idempotent');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    writeAccounting(fixture, [
      { operation: 'bolt11.pay', before: 500, after: 400 },
      { operation: 'cashu.redeem', before: 400, after: 440 },
    ]);
    const prepared = writePreparedCashuOutflow(fixture);
    fixture.ledger.recordOutflow('asset-01', {
      amount: 40,
      fees: 0,
      counterparty: 'cocod-test-wallet',
      txId: prepared.fingerprint.slice(0, 16),
    });

    await recoverStaleFundedSessions({
      artifactsRoot: fixture.artifactsRoot,
      cocod: fakeCocod({ initialBalance: 440 }),
      openRecovery: () =>
        fakeRecovery({
          runDir: fixture.runDir,
          report: sixtyRestoredReport,
          inspectCashuToken: async () => ({
            totalAmount: 40,
            unspentAmount: 0,
            pendingAmount: 0,
            spentAmount: 40,
          }),
        }),
    });

    const accounting = JSON.parse(
      readFileSync(join(fixture.runDir, 'funded-runtime', 'cocod-accounting.json'), 'utf8')
    ) as { observations: { operation: string }[] };
    expect(
      accounting.observations.filter(({ operation }) => operation === 'cashu.redeem')
    ).toHaveLength(1);
    expect(
      fixture.ledger
        .read()
        .filter(
          (entry) => entry.kind === 'outflow' && entry.txId === prepared.fingerprint.slice(0, 16)
        )
    ).toHaveLength(1);
  });

  it('resumes evidence repair after a terminal outflow was persisted first', async () => {
    const fixture = sessionFixture('terminal-repair-resume');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    writeAccounting(fixture, [{ operation: 'bolt11.pay', before: 500, after: 400 }]);
    const outflowId = writeReceivedCashuOutflow(fixture, 40, 400, 440);

    await recoverStaleFundedSessions({
      artifactsRoot: fixture.artifactsRoot,
      cocod: fakeCocod({ initialBalance: 440 }),
      openRecovery: () =>
        fakeRecovery({
          runDir: fixture.runDir,
          report: sixtyRestoredReport,
        }),
    });

    const accounting = JSON.parse(
      readFileSync(join(fixture.runDir, 'funded-runtime', 'cocod-accounting.json'), 'utf8')
    ) as { observations: { operation: string; delta: number }[] };
    expect(accounting.observations.filter(({ operation }) => operation === 'cashu.redeem')).toEqual(
      [expect.objectContaining({ delta: 40 })]
    );
    expect(
      fixture.ledger.read().filter((entry) => entry.kind === 'outflow' && entry.txId === outflowId)
    ).toHaveLength(1);
  });

  it('preserves custody instead of classifying unexplained missing principal as fees', async () => {
    const fixture = sessionFixture('principal-gap');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    writeAccounting(fixture, [{ operation: 'bolt11.pay', before: 500, after: 400 }]);

    await expect(
      recoverStaleFundedSessions({
        artifactsRoot: fixture.artifactsRoot,
        cocod: fakeCocod(),
        openRecovery: () =>
          fakeRecovery({
            runDir: fixture.runDir,
            report: {
              assets: [
                {
                  asset: ASSET,
                  restoredAmount: 90,
                  tokenAmount: 90,
                  counterpartyDelta: 90,
                  sendFee: 0,
                  receiveFee: 0,
                  residualAmount: 0,
                },
              ],
              counterpartyTokens: [],
            },
          }),
      })
    ).rejects.toThrow(/unexplained funded liability principal/);

    expect(fixture.ledger.status().get('asset-01')).toBe('funded');
    expect(existsSync(join(fixture.fundedCustodyDir, 'recovery.json'))).toBe(true);
    expect(readdirSync(join(fixture.liabilityDir, 'custody')).length).toBe(2);
  });

  it('clears a stale per-leg effect lease only after recovery and reconciliation succeed', async () => {
    const fixture = sessionFixture('lease-success');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    writeAccounting(fixture, [{ operation: 'bolt11.pay', before: 500, after: 400 }]);
    const staleLease = fixture.ledger.acquireEffectLease('asset-01').path;
    expect(existsSync(staleLease)).toBe(true);

    const result = await recoverStaleFundedSessions({
      artifactsRoot: fixture.artifactsRoot,
      cocod: fakeCocod(),
      openRecovery: () =>
        fakeRecovery({
          runDir: fixture.runDir,
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
        }),
    });

    expect(result.recovered[0].clearedEffectLeases).toBe(1);
    expect(existsSync(staleLease)).toBe(false);
  });

  it('preserves recovery, ledger custody, ledger state, and effect leases when recovery fails', async () => {
    const fixture = sessionFixture('failure');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    writeAccounting(fixture, [{ operation: 'bolt11.pay', before: 500, after: 400 }]);
    const staleLease = fixture.ledger.acquireEffectLease('asset-01').path;
    const recoveryPath = join(fixture.fundedCustodyDir, 'recovery.json');
    const ledgerBefore = readFileSync(fixture.ledger.path, 'utf8');

    await expect(
      recoverStaleFundedSessions({
        artifactsRoot: fixture.artifactsRoot,
        cocod: fakeCocod(),
        openRecovery: () => fakeRecovery({ runDir: fixture.runDir, fail: true }),
      })
    ).rejects.toThrow(/stale funded recovery failed/);

    expect(existsSync(recoveryPath)).toBe(true);
    expect(existsSync(staleLease)).toBe(true);
    expect(readFileSync(fixture.ledger.path, 'utf8')).toBe(ledgerBefore);
    expect(readdirSync(join(fixture.liabilityDir, 'custody')).length).toBe(2);
  });

  it('never cancels a zero-value intent while its value-effect lease is retained', async () => {
    const fixture = sessionFixture('zero-lease');
    const staleLease = fixture.ledger.acquireEffectLease('asset-01').path;

    await expect(
      recoverStaleFundedSessions({
        artifactsRoot: fixture.artifactsRoot,
        cocod: fakeCocod(),
        openRecovery: () => fakeRecovery({ runDir: fixture.runDir }),
      })
    ).rejects.toThrow(/unexplained empty funded asset/);

    expect(fixture.ledger.status().get('asset-01')).toBe('intent');
    expect(existsSync(staleLease)).toBe(true);
    expect(existsSync(join(fixture.fundedCustodyDir, 'recovery.json'))).toBe(true);
  });

  it('never cancels a zero-value intent whose funding outcome was quarantined', async () => {
    const fixture = sessionFixture('zero-quarantine');
    fixture.ledger.quarantine('asset-01', 'funding-effect-uncertain');

    await expect(
      recoverStaleFundedSessions({
        artifactsRoot: fixture.artifactsRoot,
        cocod: fakeCocod(),
        openRecovery: () => fakeRecovery({ runDir: fixture.runDir }),
      })
    ).rejects.toThrow(/unexplained empty funded asset/);

    expect(fixture.ledger.status().get('asset-01')).toBe('quarantined');
    expect(existsSync(join(fixture.fundedCustodyDir, 'recovery.json'))).toBe(true);
  });

  it('cleans terminal ledger custody when recovery custody was already disposed', async () => {
    const fixture = sessionFixture('terminal-ledger-only');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    fixture.ledger.recordSweep('asset-01', {
      asset: {
        mintUrl: ASSET.mintUrl,
        unit: ASSET.unit,
        accountIndex: ASSET.accountIndex,
      },
      ok: true,
      recoveredAmount: 100,
      residualAmount: 0,
      fees: 0,
    });
    fixture.ledger.reconcile('asset-01');
    unlinkSync(join(fixture.fundedCustodyDir, 'recovery.json'));

    const result = await recoverStaleFundedSessions({
      artifactsRoot: fixture.artifactsRoot,
      cocod: fakeCocod(),
    });

    expect(result.recovered).toEqual([
      expect.objectContaining({ cancelledLegs: 0, reconciledLegs: 1 }),
    ]);
    expect(readdirSync(join(fixture.liabilityDir, 'custody'))).toEqual([]);
    expect(auditFundedRecoverySessions(fixture.artifactsRoot)).toEqual({
      status: 'clean',
      sessions: [],
      blockers: [],
    });
  });

  it('treats a spent-by-app counterparty token as proof, not recovered cocod value', async () => {
    const fixture = sessionFixture('spent-token');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    writeAccounting(fixture, [{ operation: 'cashu.create', before: 505, after: 400 }]);

    await recoverStaleFundedSessions({
      artifactsRoot: fixture.artifactsRoot,
      cocod: fakeCocod(),
      openRecovery: () =>
        fakeRecovery({
          runDir: fixture.runDir,
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
            counterpartyTokens: [
              {
                asset: ASSET,
                tokenAmount: 100,
                counterpartyDelta: 0,
                fee: 5,
                disposition: 'spent-by-app',
              },
            ],
          },
        }),
    });

    expect(fixture.ledger.read().filter(({ kind }) => kind === 'sweep')).toEqual([
      expect.objectContaining({ recoveredAmount: 100, fees: 0 }),
    ]);
  });

  it('blocks a pending invoice until its durable settlement deadline passes', async () => {
    const fixture = sessionFixture('pending-invoice');
    writeAccounting(fixture, [], [{ amount: 100, beforeBalance: 0, settlementDeadlineMs: 10_000 }]);

    await expect(
      recoverStaleFundedSessions({
        artifactsRoot: fixture.artifactsRoot,
        cocod: fakeCocod(),
        openRecovery: () => fakeRecovery({ runDir: fixture.runDir }),
        now: () => 9_999,
      })
    ).rejects.toThrow(/settlement window/);

    expect(fixture.ledger.status().get('asset-01')).toBe('intent');
    expect(existsSync(join(fixture.fundedCustodyDir, 'recovery.json'))).toBe(true);
  });

  it('clears internal recovery leases only after the global owner is proven dead', async () => {
    const fixture = sessionFixture('internal-lease');
    fixture.ledger.markFunded('asset-01', { amount: 100, fees: 0 });
    writeAccounting(fixture, [{ operation: 'bolt11.pay', before: 500, after: 400 }]);
    const locksDir = join(fixture.fundedCustodyDir, 'locks');
    mkdirSync(locksDir, { recursive: true, mode: 0o700 });
    const internalLease = join(locksDir, 'effects.lock');
    writeFileSync(internalLease, 'stale', { mode: 0o600 });
    const openRecovery = () =>
      fakeRecovery({
        runDir: fixture.runDir,
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

    expect(auditFundedRecoverySessions(fixture.artifactsRoot, openRecovery).status).toBe('blocked');
    await recoverStaleFundedSessions({
      artifactsRoot: fixture.artifactsRoot,
      cocod: fakeCocod(),
      openRecovery,
      staleOwnerIsDead: true,
    });

    expect(existsSync(internalLease)).toBe(false);
  });

  it('retains and blocks ambiguous private temp files', async () => {
    const fixture = sessionFixture('private-temp');
    const tempPath = join(fixture.fundedCustodyDir, 'recovery.json.123.abcdef.tmp');
    writeFileSync(tempPath, MNEMONIC, { mode: 0o600 });

    expect(
      auditFundedRecoverySessions(
        fixture.artifactsRoot,
        () => fakeRecovery({ runDir: fixture.runDir }),
        { staleOwnerIsDead: true }
      )
    ).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ reason: 'ambiguous-private-temp' })],
    });
    expect(existsSync(tempPath)).toBe(true);
  });

  it('ignores legacy root artifacts that are not run/session recovery directories', async () => {
    const artifactsRoot = mkdtempSync(join(tmpdir(), 'sovran-funded-startup-legacy-'));
    const legacyCustody = join(artifactsRoot, 'funded-custody');
    mkdirSync(legacyCustody, { recursive: true });
    writeFileSync(join(legacyCustody, 'recovery.json'), '{"legacy":true}');
    writeFileSync(join(artifactsRoot, 'legacy-SEEDS.json'), '{"legacy":true}');

    expect(scanFundedRecoverySessions(artifactsRoot)).toEqual([]);
    expect(auditFundedRecoverySessions(artifactsRoot)).toEqual({
      status: 'clean',
      sessions: [],
      blockers: [],
    });
    await expect(
      recoverStaleFundedSessions({ artifactsRoot, cocod: fakeCocod() })
    ).resolves.toEqual({ status: 'clean', recovered: [], audit: expect.any(Object) });
    expect(existsSync(join(legacyCustody, 'recovery.json'))).toBe(true);
  });
});
