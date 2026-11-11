/**
 * @fileoverview Groups rebalance plan steps for display.
 *
 * Consecutive steps sharing a `chainId` are merged into a single visual
 * group so they render inside one card (the "chain card"). Standalone steps
 * (no chainId) are kept as single-step groups.
 *
 * Steps that are `skipped` and have no `chainId` are filtered out — these
 * are original direct-transfer steps that were replaced by an auto-routed
 * middleman chain.
 */

import type { TransferStep } from './rebalancePlanner';
import type { StepStatus } from './RebalanceStepRow';

export interface StepState {
  status: StepStatus;
  errorMessage?: string;
  invoice?: string;
  operationId?: string;
  routeSuggestion?: {
    status: 'searching' | 'found' | 'none';
    path?: string[];
    pathNames?: string[];
  };
  routingDetail?: string;
}

/** A run of consecutive items sharing a `chainId` (one chain card), or one standalone item. */
export interface ChainGroup<T> {
  id: string;
  chainId: string | null;
  items: T[];
  /** Full ordered path when this is a middleman chain group. */
  chainPath?: string[];
}

/**
 * Groups consecutive items sharing a `chainId`, keyed `chain-<chainId>`; a
 * later run of the same chain starts a new group. Items without a `chainId`
 * stand alone under their own id. Used by the plan cards and swap history.
 */
export function groupAdjacentChains<
  T extends { id: string; chainId?: string; chainPath?: string[] },
>(items: T[]): ChainGroup<T>[] {
  const groups: ChainGroup<T>[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (item.chainId && last?.chainId === item.chainId) last.items.push(item);
    else if (item.chainId)
      groups.push({
        id: `chain-${item.chainId}`,
        chainId: item.chainId,
        items: [item],
        chainPath: item.chainPath,
      });
    else groups.push({ id: item.id, chainId: null, items: [item] });
  }
  return groups;
}

/**
 * Groups plan steps by `chainId` and filters skipped originals.
 *
 * A step is considered a "skipped original" when its status is `skipped`
 * and it has no `chainId` — meaning it was the direct A→C transfer that
 * the auto-router replaced with a chain (A→D→C).
 */
export function groupStepsForDisplay(
  steps: TransferStep[],
  stepStates: Record<string, StepState>
): ChainGroup<TransferStep>[] {
  return groupAdjacentChains(
    steps.filter((step) => !(stepStates[step.id]?.status === 'skipped' && !step.chainId))
  );
}
