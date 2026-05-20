/**
 * @fileoverview Rebalance Planner
 *
 * Pure functions to compute the minimal set of transfers needed to
 * move from current balances to desired distribution.
 *
 * Uses basis points (10,000 = 100%) for precise integer math.
 */

import { TOTAL_BASIS_POINTS } from '@/shared/stores/profile/mintDistributionStore';

/** Default minimum transfer amount in sats (used as fallback when no setting is provided). */
const MIN_TRANSFER_THRESHOLD = 5;

/**
 * Estimated fee percentage for Lightning transfers (as a decimal, e.g., 0.02 = 2%)
 * This is a conservative estimate to ensure we don't over-allocate from surplus mints.
 * Actual fees may be lower, but it's better to under-transfer than fail.
 */
const ESTIMATED_FEE_PERCENTAGE = 0.02; // 2%

/**
 * Minimum fee reserve in sats.
 * Must be high enough to cover the mint's Lightning fee_reserve (typically 2–10 sats)
 * plus potential input fees per proof.  5 sats is a safer planning floor that
 * reduces the chance of steps being skipped at execution time due to insufficient
 * headroom.  The executor handles the real fee_reserve dynamically via melt quote
 * probes, so this only affects upfront planning accuracy.
 */
export const MIN_FEE_RESERVE = 5;

interface MintBalance {
  mintUrl: string;
  balance: number; // Current balance in sats (or smallest unit)
}

export interface TransferStep {
  id: string;
  fromMintUrl: string;
  toMintUrl: string;
  amount: number; // Amount to transfer in sats
  // Middleman chain metadata (set when rerouting through intermediary)
  chainId?: string; // shared ID linking all legs of the chain
  /** Full ordered path of mint URLs: [source, via1, via2, ..., destination]. */
  chainPath?: string[];
  /** 0-based index of this step's hop within the chain (0 = first leg). */
  chainHopIndex?: number;
}

export interface RebalancePlan {
  steps: TransferStep[];
  totalAmount: number; // Total amount being moved
  currentBalances: Record<string, number>;
  targetBalances: Record<string, number>;
}

/**
 * Compute target balances from current total and desired distribution (basis points)
 *
 * Uses "largest remainder" method for deterministic rounding that preserves total.
 */
function computeTargetBalances(
  currentBalances: Record<string, number>,
  distributionBp: Record<string, number>,
  mintUrls: string[]
): Record<string, number> {
  const total = Object.values(currentBalances).reduce((sum, bal) => sum + bal, 0);

  if (total === 0) {
    // No balance to distribute
    return mintUrls.reduce(
      (acc, url) => {
        acc[url] = 0;
        return acc;
      },
      {} as Record<string, number>
    );
  }

  // Calculate raw targets and track remainders for rounding
  const rawTargets: { mintUrl: string; floor: number; remainder: number }[] = [];

  for (const mintUrl of mintUrls) {
    const bp = distributionBp[mintUrl] || 0;
    const exact = (total * bp) / TOTAL_BASIS_POINTS;
    const floor = Math.floor(exact);
    const remainder = exact - floor;
    rawTargets.push({ mintUrl, floor, remainder });
  }

  // Sum of floors
  const floorSum = rawTargets.reduce((sum, t) => sum + t.floor, 0);
  let remaining = total - floorSum;

  // Distribute remaining sats using largest remainder method
  // Sort by remainder descending, then by mintUrl for stability
  rawTargets.sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.mintUrl.localeCompare(b.mintUrl);
  });

  const targets: Record<string, number> = {};
  for (const t of rawTargets) {
    if (remaining > 0) {
      targets[t.mintUrl] = t.floor + 1;
      remaining--;
    } else {
      targets[t.mintUrl] = t.floor;
    }
  }

  return targets;
}

interface SurplusDeficit {
  mintUrl: string;
  amount: number; // positive = surplus, we track absolute value
}

/**
 * Calculate the maximum amount we can transfer given an available balance.
 * Accounts for fee reserve.
 */
function maxTransferableAmount(availableBalance: number): number {
  // We need: transferAmount + fee <= availableBalance
  // fee ≈ max(transferAmount * FEE_PERCENTAGE, MIN_FEE_RESERVE)
  // Solving: transferAmount + transferAmount * FEE_PERCENTAGE <= availableBalance
  // transferAmount * (1 + FEE_PERCENTAGE) <= availableBalance
  // transferAmount <= availableBalance / (1 + FEE_PERCENTAGE)

  // First, check if we can cover minimum fee
  if (availableBalance <= MIN_FEE_RESERVE) {
    return 0;
  }

  // Calculate max amount accounting for percentage fee
  const maxWithPercentage = Math.floor(availableBalance / (1 + ESTIMATED_FEE_PERCENTAGE));

  // But also ensure we have at least MIN_FEE_RESERVE for the fee
  const maxWithMinFee = availableBalance - MIN_FEE_RESERVE;

  return Math.min(maxWithPercentage, maxWithMinFee);
}

/**
 * Compute minimal transfer steps using greedy matching.
 *
 * Each step exhausts either the largest surplus or largest deficit,
 * yielding at most (surplusCount + deficitCount - 1) steps.
 *
 * Accounts for estimated Lightning fees when computing surplus amounts.
 */
function computeTransferSteps(
  currentBalances: Record<string, number>,
  targetBalances: Record<string, number>,
  threshold: number = MIN_TRANSFER_THRESHOLD
): TransferStep[] {
  // Compute deltas: current - target
  // Positive = surplus (needs to send), negative = deficit (needs to receive)
  const surpluses: SurplusDeficit[] = [];
  const deficits: SurplusDeficit[] = [];

  for (const mintUrl of Object.keys(currentBalances)) {
    const current = currentBalances[mintUrl] || 0;
    const target = targetBalances[mintUrl] || 0;
    const delta = current - target;

    if (delta > 0) {
      // Store raw surplus — per-step fee overhead is deducted in the greedy loop
      // so that each transfer correctly reserves fees from the remaining balance.
      if (delta > MIN_FEE_RESERVE) {
        surpluses.push({ mintUrl, amount: delta });
      }
    } else if (delta < 0) {
      deficits.push({ mintUrl, amount: -delta }); // Store as positive
    }
  }

  // Sort by amount descending for greedy matching
  surpluses.sort((a, b) => b.amount - a.amount);
  deficits.sort((a, b) => b.amount - a.amount);

  const steps: TransferStep[] = [];
  let stepId = 0;

  // Greedy matching: always pick largest surplus and largest deficit.
  // Each iteration accounts for per-step fee overhead so the planner
  // never over-commits a source mint's balance across multiple steps.
  while (surpluses.length > 0 && deficits.length > 0) {
    const surplus = surpluses[0];
    const deficit = deficits[0];

    // Cap to what the surplus can actually transfer after reserving fees
    const maxFromSurplus = maxTransferableAmount(surplus.amount);
    if (maxFromSurplus < threshold) {
      surpluses.shift();
      continue;
    }

    const transferAmount = Math.min(maxFromSurplus, deficit.amount);

    if (transferAmount >= threshold) {
      steps.push({
        id: `step-${stepId++}`,
        fromMintUrl: surplus.mintUrl,
        toMintUrl: deficit.mintUrl,
        amount: transferAmount,
      });
    }

    // Deduct transfer amount + estimated fee for this step.
    // This ensures later steps from the same surplus see the real
    // remaining balance, not an inflated one that ignores prior fees.
    const estimatedStepFee = Math.max(
      Math.ceil(transferAmount * ESTIMATED_FEE_PERCENTAGE),
      MIN_FEE_RESERVE
    );
    surplus.amount -= transferAmount + estimatedStepFee;
    deficit.amount -= transferAmount;

    // Remove exhausted entries
    if (surplus.amount <= 0) {
      surpluses.shift();
    } else {
      // Re-sort if needed (though with greedy largest-first, this maintains order)
      surpluses.sort((a, b) => b.amount - a.amount);
    }

    if (deficit.amount <= 0) {
      deficits.shift();
    } else {
      deficits.sort((a, b) => b.amount - a.amount);
    }
  }

  return steps;
}

/**
 * Compute full rebalance plan from current state and desired distribution.
 */
export function computeRebalancePlan(
  mintBalances: MintBalance[],
  distributionBp: Record<string, number>,
  threshold: number = MIN_TRANSFER_THRESHOLD
): RebalancePlan {
  const mintUrls = mintBalances.map((m) => m.mintUrl);
  const currentBalances: Record<string, number> = {};

  for (const { mintUrl, balance } of mintBalances) {
    currentBalances[mintUrl] = balance;
  }

  const targetBalances = computeTargetBalances(currentBalances, distributionBp, mintUrls);
  const steps = computeTransferSteps(currentBalances, targetBalances, threshold);
  const totalAmount = steps.reduce((sum, step) => sum + step.amount, 0);

  return {
    steps,
    totalAmount,
    currentBalances,
    targetBalances,
  };
}

/**
 * Check if balances are already at target (within threshold)
 */
export function isAlreadyBalanced(
  currentBalances: Record<string, number>,
  targetBalances: Record<string, number>,
  threshold: number = MIN_TRANSFER_THRESHOLD
): boolean {
  for (const mintUrl of Object.keys(currentBalances)) {
    const current = currentBalances[mintUrl] || 0;
    const target = targetBalances[mintUrl] || 0;
    if (Math.abs(current - target) >= threshold) {
      return false;
    }
  }
  return true;
}
