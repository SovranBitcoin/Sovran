import { describe, expect, it } from 'vitest';

import {
  buildMethodAwareMintCandidates,
  deriveMintMethodCapabilityMapFromTrustedMints,
  deriveMintMethodSupportFromInfo,
  evaluateMintMethodAmountAvailability,
  getCapabilityUnavailableReason,
  getMintMethodCapability,
} from '../../src/mint-capabilities';
import type { MintMethodRequirement, WalletContext } from '../../src/types';
import { MINT1, MINT2 } from '../_harness/fixtures';

describe('mint method capabilities', () => {
  it('allows legacy bolt11 sat when NUT method-unit metadata is missing', () => {
    const support = deriveMintMethodSupportFromInfo({});

    expect(support.mint.bolt11?.supported).toBe(true);
    expect(support.mint.bolt11?.legacySatAllowed).toBe(true);
    expect(support.melt.bolt11?.supported).toBe(true);
    expect(support.mint.onchain?.supported).toBe(false);
    expect(support.melt.onchain?.supported).toBe(false);
  });

  it('requires explicit onchain NUT-04 metadata for receive', () => {
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
