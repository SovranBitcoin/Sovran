import { describe, expect, it } from 'vitest';

import {
  buildMethodAwareMintCandidates,
  compareMintDisplayOrder,
  deriveMintMethodCapabilityMapFromTrustedMints,
  deriveMintMethodSupportFromInfo,
  evaluateMintMethodAmountAvailability,
  getCapabilityUnavailableReason,
  getMintMethodCapability,
} from '../../src/mint-capabilities';
import type { MintMethodRequirement, WalletContext } from '../../src/types';
import { MINT1, MINT2 } from '../_harness/fixtures';

describe('mint method capabilities', () => {
  it('requires explicit method-unit metadata', () => {
    const support = deriveMintMethodSupportFromInfo({});

    expect(support.mint.bolt11?.supported).toBe(false);
    expect(support.melt.bolt11?.supported).toBe(false);
    expect(support.mint.onchain?.supported).toBe(false);
    expect(support.melt.onchain?.supported).toBe(false);
  });

  it('recognizes onchain NUT-04 metadata as an implemented receive method (coco v2)', () => {
    const capabilities = deriveMintMethodCapabilityMapFromTrustedMints([
      {
        mintUrl: MINT1,
        mintInfo: {
          nuts: {
            '4': { methods: [{ method: 'onchain', unit: 'sat', min_amount: 100 }] },
          },
        },
      },
    ]);
    const requirement: MintMethodRequirement = {
      operation: 'mint',
      method: 'onchain',
      unit: 'sat',
    };

    const capability = getMintMethodCapability(
      { mintMethodCapabilities: capabilities },
      MINT1,
      requirement
    );

    expect(capability.supported).toBe(true);
    expect(getCapabilityUnavailableReason(capability, requirement, 50)).toBeNull();
  });

  it('treats disabled NUT settings as unavailable', () => {
    const support = deriveMintMethodSupportFromInfo({
      nuts: {
        '5': {
          disabled: true,
          methods: [{ method: 'bolt11', unit: 'sat' }],
        },
      },
    });

    expect(support.melt.bolt11?.supported).toBe(false);
    expect(support.melt.bolt11?.disabled).toBe(true);
  });

  it('builds selector candidates that disable mints without the requested method', () => {
    const wallet: WalletContext = {
      trustedMintUrls: [MINT1, MINT2],
      mintBalances: { [MINT1]: 1000, [MINT2]: 0 },
      proofAmounts: {},
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
        {
          mintUrl: MINT1,
          mintInfo: { nuts: { '4': { methods: [{ method: 'bolt11', unit: 'sat' }] } } },
        },
        {
          mintUrl: MINT2,
          mintInfo: { nuts: { '4': { methods: [{ method: 'onchain', unit: 'sat' }] } } },
        },
      ]),
    };

    const candidates = buildMethodAwareMintCandidates(wallet, {
      operation: 'mint',
      method: 'onchain',
      unit: 'sat',
    });

    expect(candidates).toMatchObject([
      // MINT2 advertises NUT-04 onchain and coco v2 implements it; MINT1
      // (bolt11-only) stays disabled for the onchain requirement.
      { mintUrl: MINT1, status: 'disabled' },
      { mintUrl: MINT2, status: 'available' },
    ]);
  });

  it('ignores advertised amount boundaries when building method candidates', () => {
    const wallet: WalletContext = {
      trustedMintUrls: [MINT1, MINT2],
      mintBalances: { [MINT1]: 0, [MINT2]: 0 },
      proofAmounts: {},
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
        {
          mintUrl: MINT1,
          mintInfo: {
            nuts: {
              '4': { methods: [{ method: 'bolt11', unit: 'sat', min_amount: 1_000 }] },
            },
          },
        },
        {
          mintUrl: MINT2,
          mintInfo: {
            nuts: {
              '4': { methods: [{ method: 'bolt11', unit: 'sat', min_amount: 100 }] },
            },
          },
        },
      ]),
    };

    const availability = evaluateMintMethodAmountAvailability(
      wallet,
      { operation: 'mint', method: 'bolt11', unit: 'sat' },
      { amount: 500, selectedMintUrl: MINT1 }
    );

    expect(availability.selectedCandidate).toMatchObject({ mintUrl: MINT1, status: 'available' });
    expect(availability.selectedUnavailableReason).toBeNull();
    expect(availability.firstUnavailableReason).toBeNull();
    expect(availability.availableCandidates).toMatchObject([
      { mintUrl: MINT1, status: 'available' },
      { mintUrl: MINT2, status: 'available' },
    ]);

    expect(
      evaluateMintMethodAmountAvailability(
        wallet,
        { operation: 'mint', method: 'bolt11', unit: 'sat' },
        { amount: 1_000, selectedMintUrl: MINT1 }
      ).selectedCandidate
    ).toMatchObject({ mintUrl: MINT1, status: 'available' });
  });
});

describe('NUT-17 capability flag', () => {
  it('reports true when the mint advertises NUT-17 subscriptions', () => {
    const support = deriveMintMethodSupportFromInfo({
      nuts: { '17': { supported: [{ method: 'bolt11', unit: 'sat', commands: [] }] } },
    });
    expect(support.nut17).toBe(true);
  });

  it('reports false when info is present but NUT-17 is absent or empty', () => {
    expect(deriveMintMethodSupportFromInfo({ nuts: {} }).nut17).toBe(false);
    expect(deriveMintMethodSupportFromInfo({ nuts: { '17': { supported: [] } } }).nut17).toBe(
      false
    );
  });

  it('reports undefined (unknown) when mintInfo has not been fetched', () => {
    expect(deriveMintMethodSupportFromInfo(undefined).nut17).toBeUndefined();
  });
});

describe('compareMintDisplayOrder', () => {
  it('sorts available first, then balance descending, keeping stable ties', () => {
    const rows = [
      { mintUrl: 'a', balance: 10, status: 'disabled' as const },
      { mintUrl: 'b', balance: 5 },
      { mintUrl: 'c', balance: 900, status: 'available' as const },
      { mintUrl: 'd', balance: 5 },
      { mintUrl: 'e', balance: 9000, status: 'disabled' as const },
    ];
    const sorted = [...rows].sort(compareMintDisplayOrder);
    expect(sorted.map((r) => r.mintUrl)).toEqual(['c', 'b', 'd', 'e', 'a']);
  });
});
