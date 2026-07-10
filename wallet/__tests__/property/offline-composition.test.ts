import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import { composeSatoshis } from "../../src/offline";

type ExpectedComposition = {
  exactMatch: boolean;
  nearestLower: number | null;
  nearestUpper: number | null;
};

function referenceComposition(
  coins: readonly number[],
  target: number,
): ExpectedComposition {
  const reachable = new Set<number>([0]);

  for (const coin of coins.filter(
    (value) => Number.isInteger(value) && value > 0,
  )) {
    const additions = [...reachable].map((sum) => sum + coin);
    for (const sum of additions) reachable.add(sum);
  }

  const positive = [...reachable]
    .filter((sum) => sum > 0)
    .sort((a, b) => a - b);
  return {
    exactMatch: reachable.has(target),
    nearestLower: positive.filter((sum) => sum <= target).at(-1) ?? null,
    nearestUpper: positive.find((sum) => sum >= target) ?? null,
  };
}

function expectCompositionToMatchReference(
  coins: number[],
  target: number,
): void {
  const expected = referenceComposition(coins, target);
  const actual = composeSatoshis(coins, target);

  expect({
    exactMatch: actual.exactMatch,
    nearestLower: actual.nearestLower,
    nearestUpper: actual.nearestUpper,
  }).toEqual(expected);
}

describe("composeSatoshis properties", () => {
  it("matches an independent subset-sum model across exhaustive and bitset thresholds", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 32 }), {
          minLength: 1,
          maxLength: 50,
        }),
        fc.integer({ min: 1, max: 1_600 }),
        (coins, target) => {
          expectCompositionToMatchReference(coins, target);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("matches the model for large-value proof sets across short-circuits and meet-in-the-middle", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 24 }), {
          minLength: 21,
          maxLength: 32,
        }),
        fc.integer({ min: 1, max: 300 }),
        (baseCoins, baseTarget) => {
          const scale = 100_000;
          const coins = baseCoins.map((coin) => coin * scale);
          const target = baseTarget * scale;
          const expected = referenceComposition(baseCoins, baseTarget);
          const actual = composeSatoshis(coins, target);

          expect({
            exactMatch: actual.exactMatch,
            nearestLower:
              actual.nearestLower == null ? null : actual.nearestLower / scale,
            nearestUpper:
              actual.nearestUpper == null ? null : actual.nearestUpper / scale,
          }).toEqual(expected);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("returns reachable, ordered bounds around every non-exact target", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 64 }), {
          minLength: 1,
          maxLength: 50,
        }),
        fc.integer({ min: 1, max: 3_200 }),
        (coins, target) => {
          const reachable = new Set<number>([0]);
          for (const coin of coins) {
            for (const sum of [...reachable]) reachable.add(sum + coin);
          }

          const result = composeSatoshis(coins, target);
          if (result.nearestLower != null) {
            expect(result.nearestLower).toBeLessThanOrEqual(target);
            expect(reachable.has(result.nearestLower)).toBe(true);
          }
          if (result.nearestUpper != null) {
            expect(result.nearestUpper).toBeGreaterThanOrEqual(target);
            expect(reachable.has(result.nearestUpper)).toBe(true);
          }
          expect(result.exactMatch).toBe(
            result.nearestLower === target && result.nearestUpper === target,
          );
        },
      ),
      { numRuns: 150 },
    );
  });
});
