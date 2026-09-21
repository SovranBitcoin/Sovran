/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * mint-selector-account-scope.test.ts — flow pickers stop at the testnut split
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A testnut mint speaks the same REAL unit as its real counterpart (`sat`), so
 * the unit alone cannot keep test funds out of a real flow. The active ACCOUNT
 * does (units/accounts): a mint on the other side of the split is not one of
 * the account's mints. Every flow picker therefore leaves it out — it is not a
 * disabled option. Only the wallet's own picker (`selected`) lists both sides,
 * because picking there moves the wallet to that mint's account.
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine } from '../_harness';
import { MINT1, MINT2 } from '../_harness/fixtures';
import { deriveMintMethodCapabilityMapFromTrustedMints } from '../../src/mint-capabilities';
import type { StepDataMap } from '../../src/machine/types';

const bolt11Info = {
  nuts: {
    '4': { methods: [{ method: 'bolt11', unit: 'sat' }, { method: 'onchain', unit: 'sat' }] },
    '5': { methods: [{ method: 'bolt11', unit: 'sat' }] },
  },
};

/** MINT1 is the real account's mint; MINT2 is a testnut across the split. */
const wallet = {
  mintBalances: { [MINT1]: 1000, [MINT2]: 0 },
  mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
    { mintUrl: MINT1, mintInfo: bolt11Info },
    { mintUrl: MINT2, mintInfo: bolt11Info, outsideAccount: true },
  ]),
};

const candidateUrls = (tm: ReturnType<typeof createTestMachine>) => {
  const call = tm.handlerCalls.filter((entry) => entry.step === 'selectMint').at(-1);
  return (call?.data as StepDataMap['selectMint']).candidates.map(
    (candidate) => candidate.mintUrl
  );
};

describe('mint selector — account scope', () => {
  it.each(['npc', 'onchain', 'bolt12'] as const)(
    'leaves the other account out of the %s picker',
    async (scope) => {
      const tm = createTestMachine({ wallet });
      await tm.machine.requestMintSelector({ scope });
      tm.assertStep('selectMint');
      expect(candidateUrls(tm)).toEqual([MINT1]);
    }
  );

  it('leaves the other account out of a Fixed Amount receive picker', async () => {
    const tm = createTestMachine({ wallet });
    await tm.machine.startReceiveLightning({ reset: true });
    await tm.machine.requestMintSelector();
    tm.assertStep('selectMint');
    expect(candidateUrls(tm)).toEqual([MINT1]);
  });

  // "as Onchain" resolves through `resolveNext`/`handleAmountEntered`, not
  // `requestMintSelector`, and gets the account rule only indirectly: a mint
  // across the split reads as method-UNSUPPORTED, and that reason is hidden
  // from flow pickers. Locked here because the two rules are independent —
  // dropping MINT_METHOD_UNSUPPORTED from the hide list would silently put the
  // other account's mints back in this picker.
  it('leaves the other account out of an "as Onchain" receive picker', async () => {
    const tm = createTestMachine({ wallet });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, '', {
      destination: 'mintQuote',
      mintQuoteMethod: 'onchain',
    });
    tm.assertStep('selectMint');
    expect(candidateUrls(tm)).toEqual([MINT1]);
  });

  it("lists both sides in the wallet's own picker", async () => {
    const tm = createTestMachine({ wallet });
    await tm.machine.requestMintSelector({ scope: 'selected' });
    tm.assertStep('selectMint');
    expect(candidateUrls(tm).sort()).toEqual([MINT1, MINT2].sort());
  });
});

describe('mint selector — recipient allow-list', () => {
  it('keeps a Nut Drop on the mints the recipient accepts after a mint change', async () => {
    // Both mints are funded, but the recipient only accepts MINT2. The mint
    // pill on the amount screen must not offer MINT1, and a pick of it must
    // never reach a (P2PK-locked, unreclaimable) send.
    const tm = createTestMachine({
      wallet: { mintBalances: { [MINT1]: 50_000, [MINT2]: 1_000 } },
    });
    await tm.machine.startSendEcash({ reset: true, allowedMints: [MINT2] });
    tm.assertStep('enterAmount');
    tm.assertContext({ mintUrl: MINT2, supportedMintUrls: [MINT2] });

    await tm.machine.requestMintSelector();
    tm.assertStep('selectMint');
    expect(candidateUrls(tm)).toEqual([MINT2]);
  });
});
