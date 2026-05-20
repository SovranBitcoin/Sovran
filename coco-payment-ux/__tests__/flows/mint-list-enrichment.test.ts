/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * mint-list-enrichment.test.ts — Mint List Data Enrichment
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests that when the machine reaches the `selectMint` step,
 * `mintListItems` is populated with full mint metadata (displayName,
 * iconUrl, balance, status, etc.) via the `buildMintListItems` operation.
 *
 * The machine has a two-phase design for mint selection:
 *   Phase 1 (transition): stepData.candidates = [{ mintUrl, balance }]
 *   Phase 2 (enrichment): stepData.mintListItems = [{ mintUrl, displayName, iconUrl, ... }]
 *
 * Phase 2 runs in the background after the handler is dispatched, so the UI
 * can open immediately with fallback rows and then observe enriched rows via
 * inspect().details.
 *
 * These tests guard against:
 *   - buildMintListItems not being called
 *   - mintListItems not being set on stepData
 *   - displayName falling back to raw URL (missing Manager metadata)
 *   - iconUrl being omitted
 *   - unreachable mints not being flagged
 *
 * Entry paths to selectMint:
 *   1. startSendEcash() with no preferred mint (multiple mints with balance)
 *   2. requestMintSelector() from any step
 *   3. execute() routing through resolveNext when multiple mints qualify
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine } from '../_harness';
import { WALLETS, MINT1, MINT2, MINT_METADATA } from '../_harness/fixtures';
import type { StepDataMap } from '../../src/machine/types';
import type { MintListItem } from '../../src/types';

async function waitForMintListStatus(
  tm: ReturnType<typeof createTestMachine>,
  status: StepDataMap['selectMint']['mintListItemsStatus'] = 'ready'
): Promise<StepDataMap['selectMint']> {
  for (let i = 0; i < 20; i++) {
    const details = tm.machine.inspect().details as StepDataMap['selectMint'];
    if (details.mintListItemsStatus === status) return details;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return tm.machine.inspect().details as StepDataMap['selectMint'];
}

// ---------------------------------------------------------------------------
// startSendEcash → selectMint
// ---------------------------------------------------------------------------

describe('mint list enrichment — startSendEcash → selectMint', () => {
  it('populates mintListItems with displayName and iconUrl', async () => {
    const tm = createTestMachine({
      wallet: { preferredMintUrl: undefined },
    });
    await tm.machine.startSendEcash();
    tm.assertStep('selectMint');

    const details = await waitForMintListStatus(tm);
    expect(details.mintListItemsStatus).toBe('ready');
    expect(details.mintListItems).toBeDefined();
    expect(details.mintListItems!.length).toBeGreaterThan(0);

    const mint1Item = details.mintListItems!.find((i) => i.mintUrl === MINT1);
    expect(mint1Item).toBeDefined();
    expect(mint1Item!.displayName).toBe(MINT_METADATA[MINT1].displayName);
    expect(mint1Item!.iconUrl).toBe(MINT_METADATA[MINT1].iconUrl);
    expect(mint1Item!.unreachable).toBeUndefined();

    const mint2Item = details.mintListItems!.find((i) => i.mintUrl === MINT2);
    expect(mint2Item).toBeDefined();
    expect(mint2Item!.displayName).toBe(MINT_METADATA[MINT2].displayName);
    expect(mint2Item!.iconUrl).toBe(MINT_METADATA[MINT2].iconUrl);
    expect(mint2Item!.unreachable).toBeUndefined();
  });

  it('buildMintListItems operation is called with correct candidates', async () => {
    const tm = createTestMachine({
      wallet: { preferredMintUrl: undefined },
    });
    await tm.machine.startSendEcash();
    tm.assertStep('selectMint');

    const opCall = tm.operationCalls.find((c) => c.name === 'buildMintListItems');
    expect(opCall).toBeTruthy();
    const arg = opCall!.args[0] as StepDataMap['selectMint'];
    expect(arg.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mintUrl: MINT1 }),
        expect.objectContaining({ mintUrl: MINT2 }),
      ])
    );
    expect(arg.unit).toBe('sat');
  });

  it('handler receives fallback mintListItems immediately', async () => {
    const tm = createTestMachine({
      wallet: { preferredMintUrl: undefined },
    });
    await tm.machine.startSendEcash();
    tm.assertStep('selectMint');

    const handlerCall = tm.handlerCalls.find((c) => c.step === 'selectMint');
    expect(handlerCall).toBeTruthy();
    const data = handlerCall!.data as StepDataMap['selectMint'];
    expect(data.mintListItems).toBeDefined();
    expect(data.mintListItems!.length).toBeGreaterThan(0);
    expect(data.mintListItemsStatus).toBe('loading');
    expect(data.mintListItems![0].displayName).toBe(data.mintListItems![0].mintUrl);
  });

  it('opens selectMint immediately even when enrichment never resolves', async () => {
    const tm = createTestMachine({
      wallet: { preferredMintUrl: undefined },
      operations: {
        buildMintListItems: async () => new Promise<MintListItem[]>(() => {}),
      },
    });
    await tm.machine.startSendEcash();
    tm.assertStep('selectMint');

    const details = await waitForMintListStatus(tm);
    expect(details.mintListItemsStatus).toBe('loading');
    expect(details.mintListItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mintUrl: MINT1, displayName: MINT1 }),
        expect.objectContaining({ mintUrl: MINT2, displayName: MINT2 }),
      ])
    );
  });
});

// ---------------------------------------------------------------------------
// requestMintSelector → selectMint
// ---------------------------------------------------------------------------

describe('mint list enrichment — requestMintSelector', () => {
  it('populates mintListItems after requestMintSelector from enterAmount', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash();
    tm.assertStep('enterAmount');

    await tm.machine.requestMintSelector({ scope: 'selected' });
    tm.assertStep('selectMint');

    const details = await waitForMintListStatus(tm);
    expect(details.mintListItems).toBeDefined();
    expect(details.mintListItems!.length).toBeGreaterThan(0);

    for (const item of details.mintListItems!) {
      expect(item.displayName).toBeDefined();
      expect(item.displayName).not.toBe('');
    }
  });

  it('populates mintListItems when requestMintSelector is called with reset', async () => {
    const tm = createTestMachine();
    await tm.machine.requestMintSelector({ reset: true });
    tm.assertStep('selectMint');

    const details = await waitForMintListStatus(tm);
    expect(details.mintListItems).toBeDefined();
    expect(details.mintListItems!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Enrichment failure
// ---------------------------------------------------------------------------

describe('mint list enrichment — failure handling', () => {
  it('keeps fallback rows when buildMintListItems throws', async () => {
    const tm = createTestMachine({
      wallet: { preferredMintUrl: undefined },
      operations: {
        buildMintListItems: async () => {
          throw new Error('Network error');
        },
      },
    });
    await tm.machine.startSendEcash();
    tm.assertStep('selectMint');

    const details = await waitForMintListStatus(tm, 'failed');
    expect(details.mintListItemsStatus).toBe('failed');
    expect(details.mintListItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mintUrl: MINT1, displayName: MINT1 }),
        expect.objectContaining({ mintUrl: MINT2, displayName: MINT2 }),
      ])
    );
  });
});

// ---------------------------------------------------------------------------
// Sorting — available first, then by balance descending
// ---------------------------------------------------------------------------

describe('mint list enrichment — sorting', () => {
  it('available mints come before disabled, highest balance first', async () => {
    const tm = createTestMachine({
      wallet: {
        ...WALLETS.multiMintUnbalanced,
        preferredMintUrl: undefined,
      },
    });
    await tm.machine.startSendEcash();
    tm.assertStep('selectMint');

    const details = await waitForMintListStatus(tm);
    const items = details.mintListItems!;

    const firstDisabledIdx = items.findIndex((i) => i.status === 'disabled');
    const lastAvailableIdx =
      items.length - 1 - [...items].reverse().findIndex((i) => i.status === 'available');

    if (firstDisabledIdx !== -1) {
      expect(lastAvailableIdx).toBeLessThan(firstDisabledIdx);
    }

    const available = items.filter((i) => i.status === 'available');
    for (let i = 1; i < available.length; i++) {
      expect(available[i - 1].balance).toBeGreaterThanOrEqual(available[i].balance);
    }

    const disabled = items.filter((i) => i.status === 'disabled');
    for (let i = 1; i < disabled.length; i++) {
      expect(disabled[i - 1].balance).toBeGreaterThanOrEqual(disabled[i].balance);
    }
  });
});

// ---------------------------------------------------------------------------
// mintListItems shape validation
// ---------------------------------------------------------------------------

describe('mint list enrichment — data shape', () => {
  it('each item has the required MintListItem fields', async () => {
    const tm = createTestMachine({
      wallet: { preferredMintUrl: undefined },
    });
    await tm.machine.startSendEcash();
    tm.assertStep('selectMint');

    const details = await waitForMintListStatus(tm);
    for (const item of details.mintListItems!) {
      expect(item).toEqual(
        expect.objectContaining({
          mintUrl: expect.any(String),
          displayName: expect.any(String),
          balance: expect.any(Number),
          unit: expect.any(String),
          status: expect.stringMatching(/^(available|disabled)$/),
          isPreferred: expect.any(Boolean),
        })
      );
      expect(typeof item.iconUrl).toBe('string');
    }
  });

  it('displayName is NOT the raw mintUrl (regression guard)', async () => {
    const tm = createTestMachine({
      wallet: { preferredMintUrl: undefined },
    });
    await tm.machine.startSendEcash();
    tm.assertStep('selectMint');

    const details = await waitForMintListStatus(tm);
    for (const item of details.mintListItems!) {
      expect(item.displayName).not.toBe(item.mintUrl);
    }
  });
});

// ---------------------------------------------------------------------------
// Unreachable mints
// ---------------------------------------------------------------------------

describe('mint list enrichment — unreachable mints', () => {
  it('marks a mint as unreachable when buildMintListItems signals it', async () => {
    const tm = createTestMachine({
      wallet: { preferredMintUrl: undefined },
      operations: {
        buildMintListItems: async (data: StepDataMap['selectMint']): Promise<MintListItem[]> =>
          data.candidates.map((c) => ({
            mintUrl: c.mintUrl,
            displayName:
              c.mintUrl === MINT2
                ? c.mintUrl
                : (MINT_METADATA[c.mintUrl]?.displayName ?? c.mintUrl),
            iconUrl: c.mintUrl === MINT2 ? undefined : MINT_METADATA[c.mintUrl]?.iconUrl,
            balance: c.balance,
            unit: data.unit,
            status: 'available' as const,
            reason: null,
            isPreferred: false,
            unreachable: c.mintUrl === MINT2 ? true : undefined,
          })),
      },
    });
    await tm.machine.startSendEcash();
    tm.assertStep('selectMint');

    const details = tm.machine.inspect().details as StepDataMap['selectMint'];
    const mint1Item = details.mintListItems!.find((i) => i.mintUrl === MINT1);
    const mint2Item = details.mintListItems!.find((i) => i.mintUrl === MINT2);

    expect(mint1Item!.unreachable).toBeUndefined();
    expect(mint1Item!.displayName).toBe(MINT_METADATA[MINT1].displayName);
    expect(mint1Item!.iconUrl).toBe(MINT_METADATA[MINT1].iconUrl);

    expect(mint2Item!.unreachable).toBe(true);
    expect(mint2Item!.displayName).toBe(MINT2);
    expect(mint2Item!.iconUrl).toBeUndefined();
  });

  it('unreachable mints remain selectable (status stays available)', async () => {
    const tm = createTestMachine({
      wallet: { preferredMintUrl: undefined },
      operations: {
        buildMintListItems: async (data: StepDataMap['selectMint']): Promise<MintListItem[]> =>
          data.candidates.map((c) => ({
            mintUrl: c.mintUrl,
            displayName: c.mintUrl,
            balance: c.balance,
            unit: data.unit,
            status: 'available' as const,
            reason: null,
            isPreferred: false,
            unreachable: true,
          })),
      },
    });
    await tm.machine.startSendEcash();
    tm.assertStep('selectMint');

    const details = tm.machine.inspect().details as StepDataMap['selectMint'];
    for (const item of details.mintListItems!) {
      expect(item.unreachable).toBe(true);
      expect(item.status).toBe('available');
    }
  });
});
