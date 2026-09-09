import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { composeSatoshis } from "../../src/offline";

describe("divisible proof denominations", () => {
  it.each([
    [18, 6, 6, 2, 2, 2],
    [24, 6, 6, 6, 2, 2],
  ])(
    "handles nonbinary chains, duplicate proofs, and gcd greater than one: %j",
    (...coins) => {
      expect(composeSatoshis(coins, 17)).toMatchObject({
        exactMatch: false,
        nearestLower: 16,
        nearestUpper: 18,
        strategy: "denomination-greedy",
      });
    },
  );

  it("avoids exponential enumeration for large repeated power-of-two proof sets", () => {
    const coins = Array.from(
      { length: 80 },
      (_, index) => 2 ** ((index % 20) + 1),
    );
    const result = composeSatoshis(coins, 1_999_999);
    expect(result).toMatchObject({
      exactMatch: false,
      nearestLower: 1_999_998,
      nearestUpper: 2_000_000,
      strategy: "denomination-greedy",
    });
  });

  it("matches independent exhaustive subset sums with gaps, duplicates, ordering, and scaled units", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 8 }), {
          minLength: 1,
          maxLength: 14,
        }),
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 8000 }),
        (powers, base, scale, target) => {
          const coins = powers.map((power) => scale * base ** power);
          const original = [...coins];
          const reachable = new Set<number>([0]);
          for (const coin of coins)
            for (const sum of [...reachable]) reachable.add(sum + coin);
          const sums = [...reachable]
            .filter((sum) => sum > 0)
            .sort((a, b) => a - b);
          expect(composeSatoshis(coins, target)).toMatchObject({
            exactMatch: reachable.has(target),
            nearestLower: sums.filter((sum) => sum <= target).at(-1) ?? null,
            nearestUpper: sums.find((sum) => sum >= target) ?? null,
          });
          expect(coins).toEqual(original);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("retains subset search for nondivisible denominations where greedy would miss the exact sum", () => {
    expect(composeSatoshis([4, 3, 3], 6)).toMatchObject({
      exactMatch: true,
      nearestLower: 6,
      nearestUpper: 6,
      strategy: "exhaustive",
    });
  });
});
