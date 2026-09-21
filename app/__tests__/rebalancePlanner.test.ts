import {
  computeRebalancePlan,
  MIN_FEE_RESERVE,
} from '@/features/mint/components/rebalance/rebalancePlanner';

jest.mock('@/shared/stores/profile/mintDistributionStore', () => ({
  TOTAL_BASIS_POINTS: 10_000,
}));

const A = 'https://a.mint';
const B = 'https://b.mint';
const C = 'https://c.mint';

function singleTransfer(balance: number): number | undefined {
  const plan = computeRebalancePlan(
    [
      { mintUrl: A, balance },
      { mintUrl: B, balance: 0 },
    ],
    { [A]: 0, [B]: 10_000 }
  );
  return plan.steps[0]?.amount;
}

describe('computeRebalancePlan fee reserve', () => {
  it('reserves the 2% estimate in whole sats at exact boundaries', () => {
    expect(singleTransfer(1020)).toBe(1000);
    expect(singleTransfer(1019)).toBe(999);
    expect(singleTransfer(102)).toBe(97);
    expect(singleTransfer(10_200_000)).toBe(10_000_000);
  });

  it('plans the largest amount whose 200 bps fee still fits the balance', () => {
    for (let balance = 1; balance <= 20_000; balance++) {
      const amount = singleTransfer(balance);
      if (amount === undefined) continue;
      expect(amount * 10_200).toBeLessThanOrEqual(balance * 10_000);
      expect(amount).toBeLessThanOrEqual(balance - MIN_FEE_RESERVE);
      const next = amount + 1;
      expect(next * 10_200 > balance * 10_000 || next > balance - MIN_FEE_RESERVE).toBe(true);
    }
  });

  it('deducts a rounded-up integer fee before planning the next step from the same mint', () => {
    const plan = computeRebalancePlan(
      [
        { mintUrl: A, balance: 1000 },
        { mintUrl: B, balance: 0 },
        { mintUrl: C, balance: 0 },
      ],
      { [A]: 0, [B]: 3500, [C]: 6500 }
    );
    // 650 to C costs ceil(650 * 200 / 10_000) = 13, leaving 337 → floor(3_370_000 / 10_200) = 330.
    expect(plan.steps.map((step) => [step.toMintUrl, step.amount])).toEqual([
      [C, 650],
      [B, 330],
    ]);
    expect(plan.totalAmount).toBe(980);
  });

  it('rounds a fractional step fee up to the next sat', () => {
    const plan = computeRebalancePlan(
      [
        { mintUrl: A, balance: 802 },
        { mintUrl: B, balance: 0 },
        { mintUrl: C, balance: 0 },
      ],
      { [A]: 0, [B]: 5000, [C]: 5000 }
    );
    // 401 costs ceil(8.02) = 9, leaving 392 → floor(3_920_000 / 10_200) = 384.
    expect(plan.steps.map((step) => step.amount)).toEqual([401, 384]);
  });
});
