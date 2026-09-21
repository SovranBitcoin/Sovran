import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { buildCatalog } from './catalog';
import { ARTIFACTS } from './paths';
import { getRunDetail, ledgerSafeToDelete } from './scan';

const REAL_RUN = 'run-2026-07-13T04-29-34-798Z-0f50b991';
// The recorded artifact is local-only evidence (artifacts/ is not committed);
// a viewer Clear removes it, so these assertions only run while it exists.
const REAL_RUN_PRESENT = existsSync(join(ARTIFACTS, REAL_RUN));

describe('getRunDetail (real artifact)', () => {
  test.skipIf(!REAL_RUN_PRESENT)('parses the toast.receive-lightning run', async () => {
    const detail = await getRunDetail(REAL_RUN);
    expect(detail).toBeDefined();
    if (!detail) return;
    expect(detail.status).toBe('complete');
    expect(detail.proof).toBe('product-run');
    expect(detail.scenarios).toHaveLength(1);
    const timeline = detail.scenarios[0];
    expect(timeline.scenarioId).toBe('toast.receive-lightning');
    expect(timeline.name).toBe('Render the Lightning receive toast lifecycle');
    expect(timeline.frames.length).toBeGreaterThan(20);
    const last = timeline.frames[timeline.frames.length - 1];
    expect(last.phase).toBe('FINAL');
    expect(last.file.endsWith('027-FINAL-final-state.png')).toBe(true);
    expect(timeline.named.length).toBeGreaterThanOrEqual(2);
    expect(timeline.named[0].file).toContain('/named/');
    const phases = new Set(timeline.frames.map((frame) => frame.phase));
    expect(phases.has('P')).toBe(true);
    expect(phases.has('T')).toBe(true);
    // every frame path is run-dir-relative
    expect(timeline.frames.every((frame) => !frame.file.startsWith('/'))).toBe(true);
    expect(detail.fundsSafeToDelete).toBe(true);
    expect(detail.commitRun).toBe(false); // pre-git-capture run
  });

  test('rejects traversal-shaped run ids', async () => {
    expect(await getRunDetail('../scenarios')).toBeUndefined();
    expect(await getRunDetail('run-..')).toBeUndefined();
  });
});

const SIM_RUN = 'run-2026-07-15T11-27-18-759Z-f2705a12';
const SIM_RUN_PRESENT = existsSync(join(ARTIFACTS, SIM_RUN, 'session-1.json'));

describe('getRunDetail deviceType', () => {
  test.skipIf(!SIM_RUN_PRESENT)('sim runs carry the simulator device type', async () => {
    const detail = await getRunDetail(SIM_RUN);
    expect(detail?.deviceType).toBe('iPhone 17 Pro');
  });
});

describe('ledgerSafeToDelete', () => {
  const asset = { mintUrl: 'https://mint.example', unit: 'sat', accountIndex: 0 };
  const base = { v: 1, runId: 'r', legId: 'asset-01', ts: 1 };
  const lines = {
    intent: {
      ...base,
      kind: 'intent',
      custody: {
        id: '0123456789abcdef',
        kind: 'cashu-token',
        len: 10,
        fingerprint: '0123456789ab',
      },
      counterparty: 'faucet',
      asset,
      expectedAmount: 100,
    },
    funded: { ...base, kind: 'funded', amount: 100, fees: 0 },
    sweep: {
      ...base,
      kind: 'sweep',
      asset,
      ok: true,
      recoveredAmount: 100,
      residualAmount: 0,
      fees: 0,
    },
    reconciled: {
      ...base,
      kind: 'reconciled',
      fundedAmount: 100,
      recoveredAmount: 100,
      outflowAmount: 0,
      fees: 0,
    },
  };
  const ledger = (...entries: object[]) => entries.map((entry) => JSON.stringify(entry)).join('\n');

  test('reconciled legs are safe', () => {
    const text = ledger(lines.intent, lines.funded, lines.sweep, lines.reconciled);
    expect(ledgerSafeToDelete(text)).toBe(true);
  });

  test('unreconciled leg is unsafe', () => {
    expect(ledgerSafeToDelete(ledger(lines.intent, lines.funded))).toBe(false);
  });

  test('unparseable ledger fails closed', () => {
    expect(ledgerSafeToDelete('not json\n')).toBe(false);
  });

  test('well-formed JSON that is not a ledger entry fails closed', () => {
    expect(ledgerSafeToDelete(ledger({ v: 1, runId: 'r', legId: 'asset-01' }))).toBe(false);
    expect(ledgerSafeToDelete(ledger({ ...base, kind: 'opened' }))).toBe(false);
    expect(ledgerSafeToDelete(ledger({ kind: 'reconciled' }))).toBe(false);
  });

  test('empty ledger is safe', () => {
    expect(ledgerSafeToDelete('')).toBe(true);
  });
});

describe('buildCatalog', () => {
  test('catalog carries descriptions, facets, and run refs', async () => {
    const catalog = await buildCatalog();
    expect(catalog.length).toBeGreaterThan(10);
    const qr = catalog.find((entry) => entry.id === 'receive.lightning.qr');
    expect(qr).toBeDefined();
    expect(qr!.description.length).toBeGreaterThan(0);
    expect(qr!.facets.flow).toBe('receive');
    expect(qr!.facets.instrument).toBe('bolt11');
    expect(qr!.facets.io).toBe('display');
    expect(qr!.facets.checks).toContain('toast');
    expect(qr!.suites).toContain('full');
    expect(catalog.find((entry) => entry.id === 'recovery.reinstall')?.platforms).toEqual(['ios']);
  });
});
