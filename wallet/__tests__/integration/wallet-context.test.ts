/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * wallet-context.test.ts — WalletContextTracker with real Manager
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests that walletContextTracker stays in sync with real Manager state using
 * a deliberately configured live mint. Run with:
 *   TEST_MINT_URL=http://127.0.0.1:3338 bun run test:live
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Manager } from '@cashu/coco-core';
import { createWalletContextTracker } from '../../src/core/walletContextTracker';
import { createTestManager, addTrustedMint, TEST_MINT } from './helpers/setup';

describe('WalletContextTracker — real Manager', () => {
  let manager: Manager;

  beforeAll(async () => {
    manager = await createTestManager();
  });

  afterAll(async () => {
    await manager.dispose();
  });

  it('starts with empty context before any mint is added', async () => {
    const tracker = createWalletContextTracker(manager);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const ctx = tracker.getContext();
    expect(ctx.trustedMintUrls).toEqual([]);
    expect(ctx.mintBalances).toEqual({});

    tracker.dispose();
  });

  it('reflects trusted mints after addMint', async () => {
    await addTrustedMint(manager, TEST_MINT);

    const tracker = createWalletContextTracker(manager);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const ctx = tracker.getContext();
    expect(ctx.trustedMintUrls).toContain(TEST_MINT);
    expect(ctx.mintBalances[TEST_MINT] ?? 0).toBe(0);

    tracker.dispose();
  });

  it('populates proofAmounts per mint', async () => {
    const tracker = createWalletContextTracker(manager);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await tracker.refresh();

    const ctx = tracker.getContext();
    expect(ctx.proofAmounts).toBeDefined();
    expect(Array.isArray(ctx.proofAmounts[TEST_MINT])).toBe(true);

    tracker.dispose();
  });

  it('reads preferredMintUrl from getter on each getContext call', async () => {
    let preferred: string | undefined = TEST_MINT;
    const tracker = createWalletContextTracker(manager, {
      getPreferredMintUrl: () => preferred,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(tracker.getContext().preferredMintUrl).toBe(TEST_MINT);

    preferred = undefined;
    expect(tracker.getContext().preferredMintUrl).toBeUndefined();

    tracker.dispose();
  });

  it('dispose stops event-driven refreshes', async () => {
    const tracker = createWalletContextTracker(manager);
    await new Promise((resolve) => setTimeout(resolve, 100));

    tracker.dispose();

    let notified = false;
    tracker.subscribe(() => {
      notified = true;
    });

    // Triggering manager events should NOT cause tracker notifications
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(notified).toBe(false);
  });
});
