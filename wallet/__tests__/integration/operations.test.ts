/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * operations.test.ts — defaultOperations with real Manager
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests built-in operations through createColada against a deliberately
 * configured live mint. Funding failures fail the suite; no assertion is
 * conditionally skipped.
 *
 * To run this live lane against a local fakewallet mint:
 *   TEST_MINT_URL=http://127.0.0.1:3338 bun run test:live
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Manager } from '@cashu/coco-core';
import { createColada } from '../../src/core/createColada';
import type { ColadaInstance } from '../../src/core/createColada';
import { createTestManager, addTrustedMint, fundWallet, TEST_MINT } from './helpers/setup';

describe('Operations — real Manager', () => {
  let manager: Manager;
  let instance: ColadaInstance;

  beforeAll(async () => {
    manager = await createTestManager();
    await addTrustedMint(manager, TEST_MINT);

    instance = createColada({ manager });
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
      destination: 'sendEcash',
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

  it('catalog data is applied to mint list items', async () => {
    const enrichedInstance = createColada({
      manager,
      fetchMintCatalog: async (mintUrls) => {
        const map: Record<string, { kymScore?: number }> = {};
        for (const url of mintUrls) {
          if (url === TEST_MINT) map[url] = { kymScore: 4.5 };
        }
        return map;
      },
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

  it('keeps trusted mint name and icon when fetchMintInfo returns null', async () => {
    const trustedMint = (await manager.mint.getAllTrustedMints()).find(
      (mint) => mint.mintUrl === TEST_MINT
    );
    expect(trustedMint).toBeDefined();

    const cachedInfoInstance = createColada({
      manager,
      fetchMintInfo: async () => null,
    });
    await cachedInfoInstance.tracker.refresh();

    const items = await cachedInfoInstance.operations.buildMintListItems!({
      amount: 0,
      unit: 'sat',
      candidates: [],
      supportedMintUrls: undefined,
    });

    const testItem = items.find((i) => i.mintUrl === TEST_MINT);
    expect(testItem).toBeDefined();
    expect(testItem!.displayName).toBe(trustedMint!.mintInfo.name);
    expect(testItem!.iconUrl).toBe(trustedMint!.mintInfo.icon_url);

    cachedInfoInstance.dispose();
  });

  it('enrichment callbacks are applied to mint review info', async () => {
    const enrichedInstance = createColada({
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

  // Live lane only (this file is excluded from the offline gate). Funding
  // failure throws in beforeAll → the block fails loudly; no
  // `if (!funded) return` silent-green escape hatch, and every assertion runs.
  describe('funded operations (live lane; requires a fakewallet mint via TEST_MINT_URL)', () => {
    beforeAll(async () => {
      await fundWallet(manager, TEST_MINT, 500);
      await instance.tracker.refresh();
    });

    it('executeSend creates a send history entry', async () => {
      const result = await instance.operations.executeSend!(TEST_MINT, 10);
      expect(result.historyEntry).toBeDefined();
      const entry = JSON.parse(result.historyEntry);
      expect(entry.type).toBe('send');
      expect(entry.mintUrl).toBe(TEST_MINT);
    });

    it('wallet context updates after send', async () => {
      await instance.tracker.refresh();
      const ctx = instance.getWalletContext();
      expect(ctx.mintBalances[TEST_MINT]).toBeLessThan(500);
    });

    it('executeReceive accepts a token and creates history', async () => {
      const sendResult = await instance.operations.executeSend!(TEST_MINT, 5);
      const sendEntry = JSON.parse(sendResult.historyEntry);
      const token = sendEntry.token || sendEntry.metadata?.token;
      expect(token).toBeTruthy();

      const result = await instance.operations.executeReceive!(token, TEST_MINT, 5);
      expect(result.historyEntry).toBeDefined();
      const entry = JSON.parse(result.historyEntry);
      expect(entry.type).toBe('receive');
    });
  });
});
