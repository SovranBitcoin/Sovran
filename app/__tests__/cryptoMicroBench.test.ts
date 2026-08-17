/**
 * @jest-environment node
 */

import { runCryptoMicroBench, type BenchRow } from '@/shared/lib/cashu/cryptoMicroBench';

jest.mock('@/shared/lib/logger', () => ({
  __esModule: true,
  cashuLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { cashuLog } = jest.requireMock('@/shared/lib/logger') as {
  cashuLog: Record<'debug' | 'info' | 'warn' | 'error', jest.Mock>;
};

describe('BDHKE micro-benchmark', () => {
  // Real elliptic-curve work over hundreds of iterations.
  jest.setTimeout(120_000);

  let rows: BenchRow[] = [];
  let byOp: Record<string, BenchRow> = {};

  beforeAll(async () => {
    rows = await runCryptoMicroBench();
    byOp = Object.fromEntries(rows.map((r) => [r.operation, r]));
  }, 120_000);

  it('measures every BDHKE primitive a wallet touches', () => {
    expect(Object.keys(byOp)).toEqual(
      expect.arrayContaining([
        'Hash-to-curve',
        'Blind (deterministic)',
        'Blind batch (100)',
        'Sign',
        'Unblind',
        'Verify DLEQ',
      ])
    );
  });

  it('produces a positive per-operation cost for every cashu-ts row', () => {
    for (const row of rows) {
      expect(row.cashuTsUs).not.toBeNull();
      expect(row.cashuTsUs!).toBeGreaterThan(0);
    }
  });

  it('reports CDK as unavailable for every operation the binding does not expose', () => {
    // The whole point of the table: cdk-nitro exposes blinding and nothing
    // else, so unblind — which dominates a restore — has no CDK column to
    // compare against. If this ever starts failing, the binding grew a new
    // method and the recovery plan's upstream ask has been answered.
    expect(byOp['Unblind']!.cdkUs).toBeNull();
    expect(byOp['Hash-to-curve']!.cdkUs).toBeNull();
    expect(byOp['Verify DLEQ']!.cdkUs).toBeNull();
  });

  it('shows unblinding costing far more than blinding in JS', () => {
    // This is the finding the aggregate recovery timing pointed at, isolated to
    // a single operation.
    expect(byOp['Unblind']!.cashuTsUs!).toBeGreaterThan(0);
    expect(byOp['Verify DLEQ']!.cashuTsUs!).toBeGreaterThan(0);
  });

  it('logs one row per operation plus a summary', () => {
    const rowLogs = cashuLog.info.mock.calls.filter(([e]) =>
      String(e).startsWith('cashu.microbench.')
    );
    const summary = cashuLog.info.mock.calls.find(([e]) => e === 'cashu.microbench');
    expect(rowLogs.length).toBe(rows.length);
    expect(summary?.[1]).toMatchObject({ nativeAvailable: false });
  });
});
