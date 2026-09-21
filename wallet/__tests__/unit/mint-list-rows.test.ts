/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * mint-list-rows.test.ts — one rule set for every frame of the mint picker
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The picker paints synchronous rows, then the enriched rows. Both ask
 * `createMintRowRules` for a row's status and reason, so the first frame says
 * what the last one will. Taken from a real session: an onchain receive whose
 * first frame disabled nine mints for `NO_BALANCE` (a receive needs none) and
 * one with no reason at all, corrected 900 ms later to `MINT_METHOD_UNSUPPORTED`.
 *
 * Every trusted mint is listed in every picker. A mint across the testnut split
 * is pickable only in the wallet's own picker (`selected`), where the pick
 * moves the wallet to that account; inside a flow it is listed, disabled.
 */

import { describe, it, expect } from 'vitest';
import { createMintRowRules } from '../../src/mint-list-rows';
import { deriveMintMethodCapabilityMapFromTrustedMints } from '../../src/mint-capabilities';
import type { StepDataMap } from '../../src/machine/types';
import { MINT1, MINT2 } from '../_harness/fixtures';

const TESTNUT = 'https://testnut.example.com';
const onchainInfo = {
  nuts: { '4': { methods: [{ method: 'onchain', unit: 'sat', min_amount: 1_000 }] } },
};
const bolt11Info = { nuts: { '4': { methods: [{ method: 'bolt11', unit: 'sat' }] } } };

const capabilityCtx = {
  trustedMintUrls: [MINT1, MINT2, TESTNUT],
  mintBalances: { [MINT1]: 0, [MINT2]: 500, [TESTNUT]: 9_000 },
  mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
    { mintUrl: MINT1, mintInfo: onchainInfo },
    { mintUrl: MINT2, mintInfo: bolt11Info },
    { mintUrl: TESTNUT, mintInfo: onchainInfo, outsideAccount: true },
  ]),
};

const rulesFor = (data: Partial<StepDataMap['selectMint']>) =>
  createMintRowRules({
    data: { candidates: [], unit: 'sat', ...data } as StepDataMap['selectMint'],
    capabilityCtx,
    crossesAccounts: (mintUrl) => mintUrl === TESTNUT,
    supportsWebsocket: () => true,
  });

describe('createMintRowRules', () => {
  it('never disables a receive for lack of balance, and names the real reason', () => {
    const rule = rulesFor({
      destination: 'mintQuote',
      amount: 5_000,
      methodRequirement: { operation: 'mint', method: 'onchain', unit: 'sat' },
    });

    expect(rule(MINT1, 0)).toEqual({ status: 'available', reason: null });
    expect(rule(MINT2, 500)).toMatchObject({
      status: 'disabled',
      reason: { code: 'MINT_METHOD_UNSUPPORTED' },
    });
  });

  it('applies the amount bounds the mint advertises', () => {
    const rule = rulesFor({
      destination: 'mintQuote',
      amount: 10,
      methodRequirement: { operation: 'mint', method: 'onchain', unit: 'sat' },
    });

    expect(rule(MINT1, 0)).toMatchObject({
      status: 'disabled',
      reason: { code: 'AMOUNT_BELOW_MINT_MIN' },
    });
  });

  it('disables an underfunded mint on a spend, with the amount-aware reason', () => {
    const rule = rulesFor({ destination: 'sendEcash', amount: 7_000 });

    expect(rule(MINT2, 500)).toMatchObject({
      status: 'disabled',
      reason: { code: 'INSUFFICIENT_BALANCE' },
    });
    expect(rule(MINT1, 0)).toMatchObject({
      status: 'disabled',
      reason: { code: 'INSUFFICIENT_BALANCE' },
    });
  });

  it('lists a mint across the testnut split in a flow, but never lets it be picked', () => {
    const rule = rulesFor({ destination: 'sendEcash', amount: 100 });

    expect(rule(TESTNUT, 9_000)).toMatchObject({
      status: 'disabled',
      reason: { code: 'MINT_OUTSIDE_ACCOUNT' },
    });
  });

  it("lets the wallet's own picker pick either side: that is how the account is switched", () => {
    const rule = rulesFor({ scope: 'selected' });

    expect(rule(TESTNUT, 9_000)).toEqual({ status: 'available', reason: null });
    expect(rule(MINT1, 0)).toEqual({ status: 'available', reason: null });
  });
});
