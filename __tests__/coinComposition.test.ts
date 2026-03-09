import {
  composeFiat,
  composeSatoshis,
  type CompositionResult,
  type FiatCompositionResult,
} from '@/features/send/lib/offlineSendSuggestions';

describe('coin composition engine', () => {
  describe('basic exact match tests', () => {
    it('matches a single coin exactly', () => {
      const result = composeSatoshis([10], 10);

      expect(result.exactMatch).toBe(true);
      expect(result.nearestLower).toBe(10);
      expect(result.nearestUpper).toBe(10);
    });

    it('matches two coins exactly', () => {
      expect(composeSatoshis([3, 7], 10).exactMatch).toBe(true);
    });

    it('matches a subset exactly', () => {
      expect(composeSatoshis([1, 5, 3, 7, 2], 10).exactMatch).toBe(true);
    });

    it('matches the total sum exactly', () => {
      expect(composeSatoshis([2, 3, 5], 10).exactMatch).toBe(true);
    });
  });

  describe('nearest values', () => {
    it('returns nearest lower and upper when no exact match exists', () => {
      const result = composeSatoshis([1, 5, 8], 10);

      expect(result.exactMatch).toBe(false);
      expect(result.nearestLower).toBe(9);
      expect(result.nearestUpper).toBe(13);
    });

    it('handles targets below some coins', () => {
      const result = composeSatoshis([3, 7, 11], 5);

      expect(result.exactMatch).toBe(false);
      expect(result.nearestLower).toBe(3);
      expect(result.nearestUpper).toBe(7);
    });

    it('handles targets above the total sum', () => {
      const result = composeSatoshis([2, 3, 5], 20);

      expect(result.exactMatch).toBe(false);
      expect(result.nearestLower).toBe(10);
      expect(result.nearestUpper).toBeNull();
    });

    it('handles all coins being above the target', () => {
      const result = composeSatoshis([100, 200, 300], 50);

      expect(result.exactMatch).toBe(false);
      expect(result.nearestLower).toBeNull();
      expect(result.nearestUpper).toBe(100);
    });
  });

  describe('edge cases', () => {
    it('returns no match for an empty coin set', () => {
      const result = composeSatoshis([], 10);

      expect(result.exactMatch).toBe(false);
      expect(result.nearestLower).toBeNull();
      expect(result.nearestUpper).toBeNull();
    });

    it('treats a zero target as invalid', () => {
      const result = composeSatoshis([5, 10], 0);

      expect(result.exactMatch).toBe(false);
      expect(result.nearestLower).toBeNull();
      expect(result.nearestUpper).toBe(5);
    });

    it('handles a non-matching single coin', () => {
      const result = composeSatoshis([7], 10);

      expect(result.exactMatch).toBe(false);
      expect(result.nearestLower).toBe(7);
      expect(result.nearestUpper).toBeNull();
    });

    it('treats duplicate coin values as separate items', () => {
      expect(composeSatoshis([5, 5, 5], 10).exactMatch).toBe(true);
    });
  });

  describe('strategy selection', () => {
    it('uses exhaustive for small coin counts', () => {
      const smallCoins = Array.from({ length: 15 }, (_, index) => index + 1);
      const result = composeSatoshis(smallCoins, 42);

      expect(result.strategy).toBe('exhaustive');
      expect(result.exactMatch).toBe(true);
    });

    it('uses bitset dp for moderate sums', () => {
      const mediumCoins = Array.from({ length: 25 }, (_, index) => (index + 1) * 10);
      const result = composeSatoshis(mediumCoins, 330);

      expect(result.strategy).toBe('bitset-dp');
      expect(result.exactMatch).toBe(true);
    });

    it('uses meet in the middle for large values', () => {
      const largeCoins = Array.from({ length: 30 }, (_, index) => 100_000 + index * 73_517);
      const target = largeCoins[5] + largeCoins[10] + largeCoins[20];
      const result = composeSatoshis(largeCoins, target);

      expect(result.strategy).toBe('meet-in-the-middle');
      expect(result.exactMatch).toBe(true);
    });
  });

  describe('realistic wallet scenarios', () => {
    it('finds the nearest bounds for a realistic wallet', () => {
      const wallet = [50_000, 120_000, 80_000, 15_000, 300_000];
      const result = composeSatoshis(wallet, 195_000);

      expect(result.exactMatch).toBe(false);
      expect(result.nearestLower).toBe(185_000);
      expect(result.nearestUpper).toBe(200_000);
    });

    it('finds an exact match in a larger wallet', () => {
      const wallet = [10_000, 25_000, 50_000, 75_000, 100_000, 150_000, 200_000, 500_000];
      const result = composeSatoshis(wallet, 275_000);

      expect(result.exactMatch).toBe(true);
    });
  });

  describe('performance', () => {
    it('handles a 35-coin MITM search quickly', () => {
      const coins = Array.from({ length: 35 }, (_, index) => 50_000 + index * 31_337);
      const target = coins[3] + coins[17] + coins[28];
      const result = composeSatoshis(coins, target);

      expect(result.strategy).toBe('meet-in-the-middle');
      expect(result.exactMatch).toBe(true);
      expect(result.elapsedMs).toBeLessThan(10_000);
    });

    it('handles a 100-coin bitset search quickly', () => {
      const coins = Array.from({ length: 100 }, (_, index) => (index % 20) + 1);
      const result = composeSatoshis(coins, 500);

      expect(result.strategy).toBe('bitset-dp');
      expect(result.exactMatch).toBe(true);
      expect(result.elapsedMs).toBeLessThan(1_000);
    });
  });

  describe('fiat composition', () => {
    it('matches a basic fiat amount', () => {
      const satsPerUsd = 100_000;
      const coins = [1_500, 2_000, 3_000, 5_000, 8_000];
      const result = composeFiat(coins, 0.02, satsPerUsd);

      expect(result.exactFiatMatch).toBe(true);
      expect(result.matchedSatoshis).not.toBeNull();
      expect(result.matchedSatoshis!).toBeGreaterThanOrEqual(result.satoshiInterval[0]);
      expect(result.matchedSatoshis!).toBeLessThanOrEqual(result.satoshiInterval[1]);
    });

    it('returns nearest fiat neighbors when there is no exact fiat match', () => {
      const satsPerUsd = 100_000;
      const coins = [3_500, 7_200];
      const result = composeFiat(coins, 0.05, satsPerUsd);

      expect(result.exactFiatMatch).toBe(false);
      expect(result.nearestLowerFiat).toEqual({ fiat: 0.04, satoshis: 3_500 });
      expect(result.nearestUpperFiat).toEqual({ fiat: 0.07, satoshis: 7_200 });
    });

    it('handles a realistic fiat wallet', () => {
      const satsPerUsd = 100_000;
      const wallet = [546, 15_000, 42_000, 100_000, 250_000, 1_000_000];

      const exactResult = composeFiat(wallet, 0.57, satsPerUsd);
      expect(exactResult.exactFiatMatch).toBe(true);

      const neighborResult = composeFiat(wallet, 3.0, satsPerUsd);
      expect(neighborResult.exactFiatMatch).toBe(false);
      expect(neighborResult.nearestLowerFiat).not.toBeNull();
      expect(neighborResult.nearestUpperFiat).not.toBeNull();
    });

    it('handles very small fiat values', () => {
      const satsPerUsd = 100_000;
      const result = composeFiat([546, 800, 1_200], 0.01, satsPerUsd);

      expect(result.exactFiatMatch).toBe(true);
    });
  });

  describe('cross-check correctness', () => {
    function bruteForceSums(coins: number[]): Set<number> {
      const sums = new Set<number>();
      const totalSubsets = 1 << coins.length;

      for (let mask = 1; mask < totalSubsets; mask += 1) {
        let sum = 0;
        for (let index = 0; index < coins.length; index += 1) {
          if (mask & (1 << index)) {
            sum += coins[index] ?? 0;
          }
        }
        sums.add(sum);
      }

      return sums;
    }

    function nearestBounds(sums: Set<number>, target: number) {
      let nearestLower: number | null = null;
      let nearestUpper: number | null = null;

      for (const sum of sums) {
        if (sum <= target && (nearestLower === null || sum > nearestLower)) {
          nearestLower = sum;
        }

        if (sum >= target && (nearestUpper === null || sum < nearestUpper)) {
          nearestUpper = sum;
        }
      }

      return { nearestLower, nearestUpper };
    }

    it('agrees with brute force across several targets', () => {
      const coins = [3, 7, 11, 19, 23, 2, 13, 17, 5, 29];
      const sums = bruteForceSums(coins);

      for (const target of [1, 10, 25, 42, 60, 75, 100, 129]) {
        const result = composeSatoshis(coins, target);
        const bounds = nearestBounds(sums, target);

        expect(result.exactMatch).toBe(sums.has(target));
        expect(result.nearestLower).toBe(bounds.nearestLower);
        expect(result.nearestUpper).toBe(bounds.nearestUpper);
      }
    });
  });
});
