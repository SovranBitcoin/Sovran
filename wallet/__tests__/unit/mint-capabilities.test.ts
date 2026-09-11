import { describe, expect, it } from 'vitest';

import {
  buildMethodAwareMintCandidates,
  compareMintDisplayOrder,
  deriveMintMethodCapabilityMapFromTrustedMints,
  deriveMintMethodSupportFromInfo,
  deriveSupportedUnitsFromInfo,
  evaluateMintMethodAmountAvailability,
  getCapabilityUnavailableReason,
  getMintMethodCapability,
  getUnitAmountEnvelope,
  pickMintForUnit,
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
    expect(capability.minAmount).toBe(100);
    expect(getCapabilityUnavailableReason(capability, requirement, 150)).toBeNull();
  });

  it('reports advertised amount bounds as unavailable reasons', () => {
    const capabilities = deriveMintMethodCapabilityMapFromTrustedMints([
      {
        mintUrl: MINT1,
        mintInfo: {
          nuts: {
            '4': {
              methods: [
                { method: 'onchain', unit: 'sat', min_amount: 1_000, max_amount: 500_000 },
              ],
            },
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

    expect(getCapabilityUnavailableReason(capability, requirement, 100)).toMatchObject({
      code: 'AMOUNT_BELOW_MINT_MIN',
      message: 'Minimum 1,000 sat',
      params: { min: 1_000, unit: 'sat' },
    });
    expect(getCapabilityUnavailableReason(capability, requirement, 600_000)).toMatchObject({
      code: 'AMOUNT_ABOVE_MINT_MAX',
      message: 'Maximum 500,000 sat',
      params: { max: 500_000, unit: 'sat' },
    });
    // No amount yet (nothing typed) — bounds cannot rule the method out.
    expect(getCapabilityUnavailableReason(capability, requirement)).toBeNull();
    expect(getCapabilityUnavailableReason(capability, requirement, 1_000)).toBeNull();
    expect(getCapabilityUnavailableReason(capability, requirement, 500_000)).toBeNull();
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

  it('enforces advertised amount boundaries when building method candidates', () => {
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

    // 500 sat clears MINT2's minimum (100) but not MINT1's (1 000): the pinned
    // MINT1 is disabled with the bounds reason while the rail itself stays
    // available through MINT2 — so no aggregate amountBoundsReason.
    const availability = evaluateMintMethodAmountAvailability(
      wallet,
      { operation: 'mint', method: 'bolt11', unit: 'sat' },
      { amount: 500, selectedMintUrl: MINT1 }
    );

    expect(availability.selectedCandidate).toMatchObject({ mintUrl: MINT1, status: 'disabled' });
    expect(availability.selectedUnavailableReason).toMatchObject({
      code: 'AMOUNT_BELOW_MINT_MIN',
      params: { min: 1_000, unit: 'sat' },
    });
    expect(availability.availableCandidates).toMatchObject([
      { mintUrl: MINT2, status: 'available' },
    ]);
    expect(availability.amountBoundsReason).toBeNull();

    expect(
      evaluateMintMethodAmountAvailability(
        wallet,
        { operation: 'mint', method: 'bolt11', unit: 'sat' },
        { amount: 1_000, selectedMintUrl: MINT1 }
      ).selectedCandidate
    ).toMatchObject({ mintUrl: MINT1, status: 'available' });

    // 50 sat is below every mint's minimum: the aggregate reason cites the
    // LEAST strict bound (MINT2's 100), not the arbitrary first mint's 1 000.
    const blocked = evaluateMintMethodAmountAvailability(
      wallet,
      { operation: 'mint', method: 'bolt11', unit: 'sat' },
      { amount: 50 }
    );
    expect(blocked.availableCandidates).toEqual([]);
    expect(blocked.amountBoundsReason).toMatchObject({
      code: 'AMOUNT_BELOW_MINT_MIN',
      message: 'Minimum 100 sat',
      params: { min: 100, unit: 'sat' },
    });
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
  it.each([100, 1_000])('orders onchain minimums before unsupported mints at %i sats', (amount) => {
    const mints = [
      { mintUrl: 'https://unsupported.test', balance: 9_000, min: null },
      { mintUrl: 'https://high-min.test', balance: 500, min: 10_000 },
      { mintUrl: 'https://mid-min.test', balance: 100, min: 2_000 },
      { mintUrl: 'https://low-min.test', balance: 0, min: 1_000 },
    ];
    const ctx = {
      trustedMintUrls: mints.map((mint) => mint.mintUrl),
      mintBalances: Object.fromEntries(mints.map((mint) => [mint.mintUrl, mint.balance])),
      mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(
        mints.map((mint) => ({
          mintUrl: mint.mintUrl,
          mintInfo: {
            nuts: {
              '4': {
                methods: mint.min == null
                  ? [{ method: 'bolt11', unit: 'sat' }]
                  : [{ method: 'onchain', unit: 'sat', min_amount: mint.min }],
              },
            },
          },
        }))
      ),
    };
    const availability = evaluateMintMethodAmountAvailability(
      ctx,
      { operation: 'mint', method: 'onchain', unit: 'sat' },
      { amount }
    );
    const rows = buildMethodAwareMintCandidates(
      ctx,
      { operation: 'mint', method: 'onchain', unit: 'sat' },
      { amount }
    ).sort(compareMintDisplayOrder);

    expect(rows.map((row) => row.mintUrl)).toEqual([
      'https://low-min.test',
      'https://mid-min.test',
      'https://high-min.test',
      'https://unsupported.test',
    ]);
    expect(rows[1].reason?.code).toBe('AMOUNT_BELOW_MINT_MIN');
    expect(rows[3].reason?.code).toBe('MINT_METHOD_UNSUPPORTED');
    if (amount < 1_000) {
      expect(availability.availableCandidates).toHaveLength(0);
      expect(availability.amountBoundsReason?.params?.min).toBe(1_000);
    } else {
      expect(availability.availableCandidates.map((candidate) => candidate.mintUrl)).toEqual([
        'https://low-min.test',
      ]);
      expect(availability.amountBoundsReason).toBeNull();
      expect(rows[0].status).toBe('available');
    }
  });

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

describe('keyset-backed unit gating', () => {
  // The chorus case: NUT-04/05 advertise bolt11 usd/eur, but the mint only
  // serves sat keysets — attempting a usd quote throws coco's "No valid
  // keysets found". Advertised units without keysets must not be offered.
  const chorusInfo = {
    nuts: {
      '4': {
        methods: [
          { method: 'bolt11', unit: 'sat' },
          { method: 'bolt11', unit: 'usd' },
          { method: 'bolt11', unit: 'eur' },
        ],
      },
      '5': {
        methods: [
          { method: 'bolt11', unit: 'sat' },
          { method: 'bolt11', unit: 'usd' },
        ],
      },
    },
  };

  it('drops advertised units the mint has no keysets for', () => {
    expect(deriveSupportedUnitsFromInfo(chorusInfo, ['sat'])).toEqual(['sat']);
  });

  it('keeps advertised units when keysets back them', () => {
    expect(deriveSupportedUnitsFromInfo(chorusInfo, ['sat', 'usd'])).toEqual(['sat', 'usd']);
  });

  it('trusts the advertisement when keyset units are unknown', () => {
    expect(deriveSupportedUnitsFromInfo(chorusInfo)).toEqual(['sat', 'usd', 'eur']);
  });

  it('marks method capabilities unsupported for unbacked units', () => {
    const support = deriveMintMethodSupportFromInfo(chorusInfo, 'usd', ['sat']);
    expect(support.mint.bolt11?.supported).toBe(false);
    expect(support.mint.bolt11?.reason).toContain('no usd keysets');
    expect(support.melt.bolt11?.supported).toBe(false);

    const satSupport = deriveMintMethodSupportFromInfo(chorusInfo, 'sat', ['sat']);
    expect(satSupport.mint.bolt11?.supported).toBe(true);
  });

  it('pickMintForUnit skips mints without keysets for the unit', () => {
    const mints = [
      { mintUrl: MINT1, mintInfo: chorusInfo, keysetUnits: ['sat'] },
      { mintUrl: MINT2, mintInfo: chorusInfo, keysetUnits: ['sat', 'usd'] },
    ];
    expect(pickMintForUnit(mints, 'usd', { [MINT1]: 999, [MINT2]: 1 })).toBe(MINT2);
  });
});

describe('getUnitAmountEnvelope', () => {
  const boundedMelt = (min?: number, max?: number) => ({
    nuts: {
      '5': {
        methods: [
          {
            method: 'bolt11',
            unit: 'sat',
            ...(min != null ? { min_amount: min } : {}),
            ...(max != null ? { max_amount: max } : {}),
          },
        ],
      },
    },
  });
  const ctxFor = (mints: { mintUrl: string; mintInfo?: unknown }[], unit = 'sat') => ({
    trustedMintUrls: mints.map((m) => m.mintUrl),
    mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(mints, unit),
  });

  it('meltQuote takes the least-strict bolt11 melt bounds across mints', () => {
    const ctx = ctxFor([
      { mintUrl: MINT1, mintInfo: boundedMelt(10, 50_000) },
      { mintUrl: MINT2, mintInfo: boundedMelt(100, 200_000) },
    ]);

    expect(getUnitAmountEnvelope(ctx, 'sat', 'meltQuote')).toEqual({
      unit: 'sat',
      minAmount: 10,
      maxAmount: 200_000,
    });
  });

  // A mint advertising bolt11/bolt12/onchain melt with DIFFERENT bounds per
  // method (onchain floors higher) — mirrors the cdk LDK/BDK test mint.
  const multiMethodMelt = {
    nuts: {
      '5': {
        methods: [
          { method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 500_000 },
          { method: 'bolt12', unit: 'sat', min_amount: 1, max_amount: 500_000 },
          { method: 'onchain', unit: 'sat', min_amount: 1_000, max_amount: 500_000 },
        ],
      },
    },
  };

  it('meltQuote reflects the SPECIFIC melt method bounds (onchain floor differs)', () => {
    const ctx = ctxFor([{ mintUrl: MINT1, mintInfo: multiMethodMelt }]);
    // onchain's advertised NUT-05 floor (1000) applies to typing, not bolt11's 1.
    expect(getUnitAmountEnvelope(ctx, 'sat', 'meltQuote', 'onchain')).toEqual({
      unit: 'sat',
      minAmount: 1_000,
      maxAmount: 500_000,
    });
    expect(getUnitAmountEnvelope(ctx, 'sat', 'meltQuote', 'bolt12')).toEqual({
      unit: 'sat',
      minAmount: 1,
      maxAmount: 500_000,
    });
    expect(getUnitAmountEnvelope(ctx, 'sat', 'meltQuote', 'bolt11')).toEqual({
      unit: 'sat',
      minAmount: 1,
      maxAmount: 500_000,
    });
  });

  it('meltQuote without a method unions all melt rails (loosest envelope)', () => {
    const ctx = ctxFor([{ mintUrl: MINT1, mintInfo: multiMethodMelt }]);
    expect(getUnitAmountEnvelope(ctx, 'sat', 'meltQuote')).toEqual({
      unit: 'sat',
      minAmount: 1,
      maxAmount: 500_000,
    });
  });

  it('a supporting mint without an advertised bound unbounds that side', () => {
    const ctx = ctxFor([
      { mintUrl: MINT1, mintInfo: boundedMelt(10, 50_000) },
      { mintUrl: MINT2, mintInfo: boundedMelt(undefined, undefined) },
    ]);

    expect(getUnitAmountEnvelope(ctx, 'sat', 'meltQuote')).toEqual({
      unit: 'sat',
      minAmount: null,
      maxAmount: null,
    });
  });

  it('mintQuote is uncapped whenever a trusted mint exists (ecash receive rail)', () => {
    const ctx = ctxFor([{ mintUrl: MINT1, mintInfo: boundedMelt(10, 50_000) }]);

    expect(getUnitAmountEnvelope(ctx, 'sat', 'mintQuote')).toEqual({
      unit: 'sat',
      minAmount: null,
      maxAmount: null,
    });
  });

  it('ecash destinations and unknown destinations never clamp', () => {
    const ctx = ctxFor([{ mintUrl: MINT1, mintInfo: boundedMelt(10, 50_000) }]);

    for (const destination of ['sendEcash', 'paymentRequest', undefined] as const) {
      expect(getUnitAmountEnvelope(ctx, 'sat', destination)).toEqual({
        unit: 'sat',
        minAmount: null,
        maxAmount: null,
      });
    }
  });

  it('no supporting mint means uncapped (availability gates Next instead)', () => {
    const ctx = ctxFor([{ mintUrl: MINT1, mintInfo: {} }]);

    expect(getUnitAmountEnvelope(ctx, 'sat', 'meltQuote')).toEqual({
      unit: 'sat',
      minAmount: null,
      maxAmount: null,
    });
  });

  it('bounds are per unit: usd bounds never leak into the sat envelope', () => {
    const usdInfo = {
      nuts: {
        '5': {
          methods: [
            { method: 'bolt11', unit: 'usd', min_amount: 5, max_amount: 1_000 },
            { method: 'bolt11', unit: 'sat', min_amount: 1 },
          ],
        },
      },
    };

    expect(
      getUnitAmountEnvelope(ctxFor([{ mintUrl: MINT1, mintInfo: usdInfo }], 'usd'), 'usd', 'meltQuote')
    ).toEqual({ unit: 'usd', minAmount: 5, maxAmount: 1_000 });
    expect(
      getUnitAmountEnvelope(ctxFor([{ mintUrl: MINT1, mintInfo: usdInfo }], 'sat'), 'sat', 'meltQuote')
    ).toEqual({ unit: 'sat', minAmount: 1, maxAmount: null });
  });
});
