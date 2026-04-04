/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * operations.test.ts — defaultOperations with real Manager
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests built-in operations through createCocoPaymentUX against a real mint.
 * Operations that require wallet funding (send, melt, receive) are gated
 * behind fundWallet and skipped when the test mint can't auto-confirm quotes.
 *
 * To run funded tests, set TEST_MINT_URL to a fakewallet mint:
 *   TEST_MINT_URL=http://localhost:3338 bun test __tests__/integration/
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Manager } from '@cashu/coco-core';
import { createCocoPaymentUX } from '../../src/core/createCocoPaymentUX';
import type { CocoPaymentUXInstance } from '../../src/core/createCocoPaymentUX';
import { createTestManager, addTrustedMint, fundWallet, TEST_MINT } from './helpers/setup';

describe('Operations — real Manager', () => {
  let manager: Manager;
  let instance: CocoPaymentUXInstance;

  beforeAll(async () => {
    manager = await createTestManager();
    await addTrustedMint(manager, TEST_MINT);

    instance = createCocoPaymentUX({ manager });
    await instance.tracker.refresh();
  });

  afterAll(async () => {
    instance.dispose();
    await manager.dispose();
  });

  // ── Operations that work without funding ────────────────────────

  it('isMintTrusted returns true for added mint', async () => {
    const result = await instance.operations.isMintTrusted!(TEST_MINT);
    expect(result).toBe(true);
  });

  it('isMintTrusted returns false for unknown mint', async () => {
    const result = await instance.operations.isMintTrusted!('https://unknown.example.com');
    expect(result).toBe(false);
  });

  it('buildMintListItems returns items for trusted mints', async () => {
    const items = await instance.operations.buildMintListItems!({
      amount: 0,
      unit: 'sat',
      candidates: [],
      supportedMintUrls: undefined,
    });

    expect(items.length).toBeGreaterThanOrEqual(1);
    const testItem = items.find((i) => i.mintUrl === TEST_MINT);
    expect(testItem).toBeDefined();
    expect(testItem!.unit).toBe('sat');
    expect(typeof testItem!.balance).toBe('number');
  });

  it('buildMintListItems marks mints with insufficient balance as disabled', async () => {
    const items = await instance.operations.buildMintListItems!({
      amount: 999999,
      unit: 'sat',
      candidates: [],
      supportedMintUrls: undefined,
    });

    const testItem = items.find((i) => i.mintUrl === TEST_MINT);
    expect(testItem).toBeDefined();
    expect(testItem!.status).toBe('disabled');
    expect(testItem!.reason?.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('buildMintReviewInfo returns mint info', async () => {
    const info = await instance.operations.buildMintReviewInfo!(TEST_MINT);

    expect(info.mintUrl).toBe(TEST_MINT);
    expect(info.displayName).toBeDefined();
    expect(info.isTrusted).toBe(true);
    expect(typeof info.balance).toBe('number');
    expect(info.unit).toBe('sat');
  });

  it('executeMintQuote creates a quote with bolt11 invoice', async () => {
    const result = await instance.operations.executeMintQuote!(TEST_MINT, 64, 'sat');

    expect(result.historyEntry).toBeDefined();
    const entry = JSON.parse(result.historyEntry);
    expect(entry.type).toBe('mint');
    expect(entry.mintUrl).toBe(TEST_MINT);
  });

  it('enrichment callbacks are applied to mint list items', async () => {
    const enrichedInstance = createCocoPaymentUX({
      manager,
      enrichMintListItem: (url) => ({
        kymScore: url === TEST_MINT ? 4.5 : undefined,
      }),
    });
    await enrichedInstance.tracker.refresh();

    const items = await enrichedInstance.operations.buildMintListItems!({
      amount: 0,
      unit: 'sat',
      candidates: [],
      supportedMintUrls: undefined,
    });

    const testItem = items.find((i) => i.mintUrl === TEST_MINT);
    expect((testItem as any)?.kymScore).toBe(4.5);

    enrichedInstance.dispose();
  });

  it('enrichment callbacks are applied to mint review info', async () => {
    const enrichedInstance = createCocoPaymentUX({
      manager,
      enrichMintReviewInfo: (url) => ({
        auditScore: url === TEST_MINT ? 3.8 : undefined,
      }),
    });
    await enrichedInstance.tracker.refresh();

    const info = await enrichedInstance.operations.buildMintReviewInfo!(TEST_MINT);
    expect((info as any).auditScore).toBe(3.8);

    enrichedInstance.dispose();
  });

  // ── Funded operations (require fakewallet mint) ─────────────────

  describe('funded operations (require fakewallet mint via TEST_MINT_URL)', () => {
    let funded = false;

    beforeAll(async () => {
      funded = await fundWallet(manager, TEST_MINT, 500);
      if (funded) {
        await instance.tracker.refresh();
      }
    });

    it('executeSend creates a send history entry', async () => {
      if (!funded) return;
      const result = await instance.operations.executeSend!(TEST_MINT, 10);
      expect(result.historyEntry).toBeDefined();
      const entry = JSON.parse(result.historyEntry);
      expect(entry.type).toBe('send');
      expect(entry.mintUrl).toBe(TEST_MINT);
    });

    it('wallet context updates after send', async () => {
      if (!funded) return;
      await instance.tracker.refresh();
      const ctx = instance.getWalletContext();
      expect(ctx.mintBalances[TEST_MINT]).toBeLessThan(500);
    });

    it('executeReceive accepts a token and creates history', async () => {
      if (!funded) return;
      const sendResult = await instance.operations.executeSend!(TEST_MINT, 5);
      const sendEntry = JSON.parse(sendResult.historyEntry);
      const token = sendEntry.token || sendEntry.metadata?.token;

      if (!token) return;

      const result = await instance.operations.executeReceive!(token, TEST_MINT, 5);
      expect(result.historyEntry).toBeDefined();
      const entry = JSON.parse(result.historyEntry);
      expect(entry.type).toBe('receive');
    });
  });
});
