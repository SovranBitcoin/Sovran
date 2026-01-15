import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * @fileoverview Mint Distribution Store
 *
 * Stores mint distribution configurations as basis points (bp).
 * 10,000 bp = 100%, allowing for precise integer math without floats.
 *
 * Key behaviors:
 * - Redistribution happens only among active mints (bp > 0)
 * - Exception: When a mint has 100% (10,000 bp) and is reduced,
 *   the removed bp is distributed to ALL other mints
 * - Uses largest-remainder method for deterministic rounding
 */

const TOTAL_BASIS_POINTS = 10_000;

interface MintDistributionState {
  // Map of unit -> { mintUrl -> distributionBp }
  distributions: Record<string, Record<string, number>>;
}

interface MintDistributionActions {
  // Getters
  getDistribution: (unit: string) => Record<string, number>;
  getMintDistribution: (unit: string, mintUrl: string) => number;

  // Core setter with redistribution logic
  setMintDistribution: (
    unit: string,
    mintUrl: string,
    newBp: number,
    allMintUrls: string[]
  ) => void;

  // Initialize distribution for a unit (equal split or preserve existing)
  initializeDistribution: (unit: string, mintUrls: string[]) => void;

  // Quick actions
  equalizeMints: (unit: string, mintUrls: string[]) => void;
  maxMint: (unit: string, mintUrl: string, allMintUrls: string[]) => void;
  minMint: (unit: string, mintUrl: string, allMintUrls: string[]) => void;

  // Utility
  clearDistribution: (unit: string) => void;
  clearAllData: () => Promise<void>;
}

type MintDistributionStore = MintDistributionState & MintDistributionActions;

/**
 * Distributes basis points using largest-remainder method
 * Ensures sum always equals exactly targetTotal (default 10,000)
 */
function distributeProportionally(
  amounts: number[],
  targetTotal: number = TOTAL_BASIS_POINTS
): number[] {
  const total = amounts.reduce((sum, a) => sum + a, 0);
  if (total === 0) {
    // Equal distribution when all are zero
    const base = Math.floor(targetTotal / amounts.length);
    const remainder = targetTotal - base * amounts.length;
    return amounts.map((_, i) => base + (i < remainder ? 1 : 0));
  }

  // Calculate proportional values with remainders
  const proportional = amounts.map((amount) => (amount / total) * targetTotal);
  const floors = proportional.map(Math.floor);
  const remainders = proportional.map((p, i) => ({ index: i, remainder: p - floors[i] }));

  // Sort by remainder descending to allocate leftover bp
  remainders.sort((a, b) => b.remainder - a.remainder);

  const currentTotal = floors.reduce((sum, f) => sum + f, 0);
  let leftover = targetTotal - currentTotal;

  // Distribute leftover bp to entries with largest remainders
  const result = [...floors];
  for (const { index } of remainders) {
    if (leftover <= 0) break;
    result[index]++;
    leftover--;
  }

  return result;
}

/**
 * Redistributes a delta among eligible mints
 * @param currentDistribution Current bp values for all mints
 * @param changedMintUrl The mint that was changed
 * @param delta Amount to redistribute (positive = take from others, negative = give to others)
 * @param eligibleMints Mints eligible for redistribution
 */
function redistributeDelta(
  currentDistribution: Record<string, number>,
  changedMintUrl: string,
  delta: number,
  eligibleMints: string[]
): Record<string, number> {
  const result = { ...currentDistribution };

  if (eligibleMints.length === 0 || delta === 0) {
    return result;
  }

  // Get current values for eligible mints
  const eligibleValues = eligibleMints.map((url) => result[url] || 0);
  const eligibleTotal = eligibleValues.reduce((sum, v) => sum + v, 0);

  if (delta > 0) {
    // Taking from others - distribute removal proportionally
    if (eligibleTotal === 0) {
      // All eligible mints are at 0, can't take anything
      return result;
    }

    // Calculate how much to take from each mint proportionally
    const takeAmounts = distributeProportionally(eligibleValues, Math.min(delta, eligibleTotal));

    eligibleMints.forEach((url, i) => {
      result[url] = Math.max(0, (result[url] || 0) - takeAmounts[i]);
    });
  } else {
    // Giving to others - distribute addition proportionally
    const giveAmount = Math.abs(delta);

    if (eligibleTotal === 0) {
      // All eligible mints at 0, distribute equally
      const perMint = Math.floor(giveAmount / eligibleMints.length);
      const remainder = giveAmount - perMint * eligibleMints.length;
      eligibleMints.forEach((url, i) => {
        result[url] = perMint + (i < remainder ? 1 : 0);
      });
    } else {
      // Distribute proportionally to existing values
      const giveAmounts = distributeProportionally(eligibleValues, giveAmount);
      eligibleMints.forEach((url, i) => {
        result[url] = (result[url] || 0) + giveAmounts[i];
      });
    }
  }

  return result;
}

export const useMintDistributionStore = create<MintDistributionStore>()(
  persist(
    (set, get) => ({
      // Initial state
      distributions: {},

      // Get distribution for a unit
      getDistribution: (unit: string) => {
        const normalizedUnit = unit.toLowerCase();
        return get().distributions[normalizedUnit] || {};
      },

      // Get specific mint's distribution
      getMintDistribution: (unit: string, mintUrl: string) => {
        const normalizedUnit = unit.toLowerCase();
        const distribution = get().distributions[normalizedUnit] || {};
        return distribution[mintUrl] || 0;
      },

      // Set mint distribution with automatic redistribution
      setMintDistribution: (
        unit: string,
        mintUrl: string,
        newBp: number,
        allMintUrls: string[]
      ) => {
        const normalizedUnit = unit.toLowerCase();
        const clampedBp = Math.max(0, Math.min(TOTAL_BASIS_POINTS, Math.round(newBp)));

        set((state) => {
          const currentDistribution = { ...(state.distributions[normalizedUnit] ?? {}) };

          // Ensure all mints have an entry
          allMintUrls.forEach((url) => {
            if (currentDistribution[url] === undefined) {
              currentDistribution[url] = 0;
            }
          });

          const currentBp = currentDistribution[mintUrl] || 0;
          const delta = clampedBp - currentBp;

          if (delta === 0) {
            return state;
          }

          // Set the new value for the changed mint
          currentDistribution[mintUrl] = clampedBp;

          // Determine eligible mints for redistribution
          const otherMints = allMintUrls.filter((url) => url !== mintUrl);

          // Check if any mint currently has 100% (special case override)
          const mintWith100Percent = allMintUrls.find(
            (url) => (state.distributions[normalizedUnit]?.[url] || 0) === TOTAL_BASIS_POINTS
          );

          let eligibleMints: string[];

          if (mintWith100Percent && mintWith100Percent !== mintUrl && delta < 0) {
            // Special case: We're giving to a mint when another has 100%
            // This shouldn't happen in normal flow, but handle it
            eligibleMints = otherMints.filter((url) => url !== mintWith100Percent);
          } else if (currentBp === TOTAL_BASIS_POINTS && delta < 0) {
            /**
             * Special case (UX): reducing a 100% mint should "wake up" the rest.
             *
             * Normal rule is “only redistribute among active mints (bp > 0)” so toggling a mint
             * doesn’t unexpectedly activate a mint the user had at 0%.
             *
             * But when a mint is at 100%, every other mint is necessarily at 0%. If we enforced the
             * active-only rule here, reducing from 100% would have nowhere to redistribute to.
             */
            eligibleMints = otherMints;
          } else {
            // Normal case: Only redistribute among active mints (bp > 0)
            eligibleMints = otherMints.filter((url) => (currentDistribution[url] || 0) > 0);

            // If no active mints and we're taking (increasing this mint),
            // we need to take from somewhere - use all other mints
            if (eligibleMints.length === 0 && delta > 0) {
              eligibleMints = otherMints;
            }
          }

          // Perform redistribution
          const newDistribution = redistributeDelta(
            currentDistribution,
            mintUrl,
            delta,
            eligibleMints
          );

          // Verify sum equals 10,000 and correct if needed
          const sum = Object.values(newDistribution).reduce((s, v) => s + v, 0);
          if (sum !== TOTAL_BASIS_POINTS && allMintUrls.length > 0) {
            const diff = TOTAL_BASIS_POINTS - sum;
            /**
             * Determinism / invariants:
             * We must always end with exactly 10,000bp. Because we do integer math + rounding,
             * we may be off by a handful of bp.
             *
             * We fix it by applying the remainder to the largest *other* mint. This keeps the
             * changed mint exactly where the user set it, and avoids “flicker” when dragging.
             */
            const largestOther = otherMints.reduce(
              (max, url) => ((newDistribution[url] || 0) > (newDistribution[max] || 0) ? url : max),
              otherMints[0]
            );
            if (largestOther) {
              newDistribution[largestOther] = Math.max(
                0,
                (newDistribution[largestOther] || 0) + diff
              );
            }
          }

          return {
            distributions: {
              ...state.distributions,
              [normalizedUnit]: newDistribution,
            },
          };
        });
      },

      // Initialize distribution for a unit
      initializeDistribution: (unit: string, mintUrls: string[]) => {
        const normalizedUnit = unit.toLowerCase();

        set((state) => {
          const existing = state.distributions[normalizedUnit];

          // If distribution exists, just ensure all mints are present
          if (existing && Object.keys(existing).length > 0) {
            const updated = { ...existing };
            let needsUpdate = false;

            // Add any new mints with 0 bp
            mintUrls.forEach((url) => {
              if (updated[url] === undefined) {
                updated[url] = 0;
                needsUpdate = true;
              }
            });

            // Remove mints that no longer exist
            Object.keys(updated).forEach((url) => {
              if (!mintUrls.includes(url)) {
                delete updated[url];
                needsUpdate = true;
              }
            });

            if (!needsUpdate) {
              return state;
            }

            // Normalize to ensure sum is 10,000
            const values = mintUrls.map((url) => updated[url] || 0);
            const sum = values.reduce((s, v) => s + v, 0);

            if (sum !== TOTAL_BASIS_POINTS && sum > 0) {
              const normalized = distributeProportionally(values, TOTAL_BASIS_POINTS);
              mintUrls.forEach((url, i) => {
                updated[url] = normalized[i];
              });
            } else if (sum === 0) {
              // Equal distribution for new setup
              const equal = distributeProportionally(
                mintUrls.map(() => 1),
                TOTAL_BASIS_POINTS
              );
              mintUrls.forEach((url, i) => {
                updated[url] = equal[i];
              });
            }

            return {
              distributions: {
                ...state.distributions,
                [normalizedUnit]: updated,
              },
            };
          }

          // Create new equal distribution
          const equalDistribution: Record<string, number> = {};
          if (mintUrls.length > 0) {
            const perMint = Math.floor(TOTAL_BASIS_POINTS / mintUrls.length);
            const remainder = TOTAL_BASIS_POINTS - perMint * mintUrls.length;
            mintUrls.forEach((url, i) => {
              equalDistribution[url] = perMint + (i < remainder ? 1 : 0);
            });
          }

          return {
            distributions: {
              ...state.distributions,
              [normalizedUnit]: equalDistribution,
            },
          };
        });
      },

      // Equalize among active mints only
      equalizeMints: (unit: string, mintUrls: string[]) => {
        const normalizedUnit = unit.toLowerCase();

        set((state) => {
          const current = state.distributions[normalizedUnit] || {};

          // Get active mints (bp > 0)
          const activeMints = mintUrls.filter((url) => (current[url] || 0) > 0);

          // If no active mints, equalize all
          const mintsToEqualize = activeMints.length > 0 ? activeMints : mintUrls;

          if (mintsToEqualize.length === 0) {
            return state;
          }

          const newDistribution: Record<string, number> = {};

          // Set non-equalized mints to 0
          mintUrls.forEach((url) => {
            if (!mintsToEqualize.includes(url)) {
              newDistribution[url] = 0;
            }
          });

          // Distribute equally among mints to equalize
          const perMint = Math.floor(TOTAL_BASIS_POINTS / mintsToEqualize.length);
          const remainder = TOTAL_BASIS_POINTS - perMint * mintsToEqualize.length;
          mintsToEqualize.forEach((url, i) => {
            newDistribution[url] = perMint + (i < remainder ? 1 : 0);
          });

          return {
            distributions: {
              ...state.distributions,
              [normalizedUnit]: newDistribution,
            },
          };
        });
      },

      // Set mint to 100%
      maxMint: (unit: string, mintUrl: string, allMintUrls: string[]) => {
        const normalizedUnit = unit.toLowerCase();

        set((state) => {
          const newDistribution: Record<string, number> = {};

          allMintUrls.forEach((url) => {
            newDistribution[url] = url === mintUrl ? TOTAL_BASIS_POINTS : 0;
          });

          return {
            distributions: {
              ...state.distributions,
              [normalizedUnit]: newDistribution,
            },
          };
        });
      },

      // Set mint to 0% and redistribute
      minMint: (unit: string, mintUrl: string, allMintUrls: string[]) => {
        const normalizedUnit = unit.toLowerCase();

        set((state) => {
          const current = state.distributions[normalizedUnit] || {};
          const currentBp = current[mintUrl] || 0;

          if (currentBp === 0) {
            return state;
          }

          const otherMints = allMintUrls.filter((url) => url !== mintUrl);

          // Check if this mint has 100% - use override behavior
          const isOnly100Percent = currentBp === TOTAL_BASIS_POINTS;

          // Get eligible mints for redistribution
          let eligibleMints: string[];
          if (isOnly100Percent) {
            // Distribute to ALL other mints
            eligibleMints = otherMints;
          } else {
            // Distribute to active mints only
            eligibleMints = otherMints.filter((url) => (current[url] || 0) > 0);
            // If no active mints, distribute to all
            if (eligibleMints.length === 0) {
              eligibleMints = otherMints;
            }
          }

          const newDistribution = { ...current };
          newDistribution[mintUrl] = 0;

          if (eligibleMints.length > 0) {
            // Distribute the removed bp
            const eligibleValues = eligibleMints.map((url) => current[url] || 0);
            const eligibleTotal = eligibleValues.reduce((sum, v) => sum + v, 0);

            if (eligibleTotal === 0) {
              // Equal distribution
              const perMint = Math.floor(currentBp / eligibleMints.length);
              const remainder = currentBp - perMint * eligibleMints.length;
              eligibleMints.forEach((url, i) => {
                newDistribution[url] = perMint + (i < remainder ? 1 : 0);
              });
            } else {
              // Proportional distribution
              const additions = distributeProportionally(eligibleValues, currentBp);
              eligibleMints.forEach((url, i) => {
                newDistribution[url] = (current[url] || 0) + additions[i];
              });
            }
          }

          return {
            distributions: {
              ...state.distributions,
              [normalizedUnit]: newDistribution,
            },
          };
        });
      },

      // Clear distribution for a unit
      clearDistribution: (unit: string) => {
        const normalizedUnit = unit.toLowerCase();

        set((state) => {
          const { [normalizedUnit]: _, ...rest } = state.distributions;
          return { distributions: rest };
        });
      },

      // Clear all data
      clearAllData: async () => {
        try {
          await AsyncStorage.removeItem('mint-distribution-store');
          set({ distributions: {} });
        } catch (error) {
          console.error('MintDistributionStore: Error clearing data:', error);
          throw error;
        }
      },
    }),
    {
      name: 'mint-distribution-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ distributions: state.distributions }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn('MintDistributionStore: Failed to rehydrate from storage:', error);
        } else if (__DEV__) {
          console.log('MintDistributionStore: Successfully rehydrated:', state?.distributions);
        }
      },
    }
  )
);

// Helper to convert bp to percentage string
export function bpToPercent(bp: number): string {
  return (bp / 100).toFixed(bp % 100 === 0 ? 0 : 1);
}

// Helper to convert percentage to bp
export function percentToBp(percent: number): number {
  return Math.round(percent * 100);
}

// Constants export
export { TOTAL_BASIS_POINTS };
