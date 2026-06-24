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

export interface StepGroup {
  id: string;
  chainId: string | null;
  steps: TransferStep[];
  /** Full ordered path when this is a middleman chain group. */
  chainPath?: string[];
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
): StepGroup[] {
  const groups: StepGroup[] = [];

  for (const step of steps) {
    const state = stepStates[step.id];

    // Hide skipped originals (no chainId = not part of a chain itself)
    if (state?.status === 'skipped' && !step.chainId) {
      continue;
    }

    if (step.chainId) {
      const last = groups[groups.length - 1];
      if (last?.chainId === step.chainId) {
        last.steps.push(step);
        continue;
      }
      groups.push({
        id: `chain-${step.chainId}`,
        chainId: step.chainId,
        steps: [step],
        chainPath: step.chainPath,
      });
    } else {
      groups.push({
        id: step.id,
        chainId: null,
        steps: [step],
      });
    }
  }

  return groups;
}
