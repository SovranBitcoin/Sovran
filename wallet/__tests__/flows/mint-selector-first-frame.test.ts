/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * mint-selector-first-frame.test.ts — the picker opens on its final row set
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The selector paints synchronous fallback rows, then replaces them with the
 * enriched rows. Those two must list the SAME mints: `buildMintListItems`
 * describes the whole account and explains each exclusion, so a fallback built
 * from the flow-filtered candidates made the row count jump a moment after the
 * sheet opened — which reads as the picker briefly showing the wrong mints.
 *
 * Taken from a real session: five trusted mints, two of them funded, where the
 * picker painted two rows and then five (three `NO_BALANCE`).
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine } from '../_harness';
import { MINT1, MINT2 } from '../_harness/fixtures';
import { deriveMintMethodCapabilityMapFromTrustedMints } from '../../src/mint-capabilities';
import type { MintListItem } from '../../src/types';
import type { StepDataMap } from '../../src/machine/types';

const FUNDED = MINT1;
const ALSO_FUNDED = MINT2;
const EMPTY_A = 'https://empty-a.example.com';
const EMPTY_B = 'https://empty-b.example.com';
const EMPTY_C = 'https://empty-c.example.com';
const ALL = [FUNDED, ALSO_FUNDED, EMPTY_A, EMPTY_B, EMPTY_C];

const info = {
  nuts: {
    '4': { methods: [{ method: 'bolt11', unit: 'sat' }] },
    '5': { methods: [{ method: 'bolt11', unit: 'sat' }] },
  },
};

const wallet = {
  trustedMintUrls: ALL,
  mintBalances: {
    [FUNDED]: 5_000,
    [ALSO_FUNDED]: 2_000,
    [EMPTY_A]: 0,
    [EMPTY_B]: 0,
    [EMPTY_C]: 0,
  },
  mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(
    ALL.map((mintUrl) => ({ mintUrl, mintInfo: info }))
  ),
};

function fallbackItems(tm: ReturnType<typeof createTestMachine>): MintListItem[] {
  const call = tm.handlerCalls.filter((entry) => entry.step === 'selectMint').at(-1);
  return (call?.data as StepDataMap['selectMint']).mintListItems ?? [];
}

describe('mint selector — first frame', () => {
  it('opens a spend picker on every account mint, not only the funded ones', async () => {
    const tm = createTestMachine({ wallet });
    await tm.machine.startSendEcash({ reset: true });
    await tm.machine.requestMintSelector();
    tm.assertStep('selectMint');

    const items = fallbackItems(tm);
    expect(items.map((item) => item.mintUrl).sort()).toEqual([...ALL].sort());
    // The unfunded ones are present but disabled, exactly as the enriched rows
    // describe them — so nothing appears or vanishes when enrichment lands.
    const byUrl = Object.fromEntries(items.map((item) => [item.mintUrl, item]));
    expect(byUrl[EMPTY_A]).toMatchObject({
      status: 'disabled',
      reason: { code: 'NO_BALANCE' },
    });
    expect(byUrl[FUNDED].status).toBe('available');
  });

  it('keeps a receive picker on the account too', async () => {
    const tm = createTestMachine({ wallet });
    await tm.machine.startReceiveLightning({ reset: true });
    await tm.machine.requestMintSelector();
    tm.assertStep('selectMint');
    expect(fallbackItems(tm).map((item) => item.mintUrl).sort()).toEqual([...ALL].sort());
  });
});
