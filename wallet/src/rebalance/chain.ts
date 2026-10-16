// ---------------------------------------------------------------------------
// Chain steps — a transfer routed through middleman mints, as one step per hop
// ---------------------------------------------------------------------------

import { logger } from '../logger';
import type { RebalanceTransfer } from './types';

/** `steps` with `toInsert` placed straight after the step `afterId`; a copy when it is not there. */
export function insertStepsAfter<T extends RebalanceTransfer>(
  steps: readonly T[],
  afterId: string,
  toInsert: readonly T[]
): T[] {
  const index = steps.findIndex((step) => step.id === afterId);
  if (index === -1) {
    logger.warn('mint.rebalance.run_state.insert_steps.missing_after', {
      afterId,
      originalCount: steps.length,
      insertCount: toInsert.length,
    });
    return [...steps];
  }
  const next = [...steps.slice(0, index + 1), ...toInsert, ...steps.slice(index + 1)];
  logger.info('mint.rebalance.run_state.insert_steps.result', {
    afterId,
    originalCount: steps.length,
    insertCount: toInsert.length,
    nextCount: next.length,
  });
  return next;
}

/**
 * One transfer per hop of `chainPath`, each a copy of `baseStep` between two
 * neighbouring mints. Ids are `makeId('<idPrefix>-<hop index>')`: swap history
 * refers to legs by these ids, so the scheme must not change.
 */
export function createChainSteps<T extends RebalanceTransfer>({
  baseStep,
  chainPath,
  chainId,
  idPrefix,
  makeId,
}: {
  baseStep: T;
  chainPath: readonly string[];
  chainId: string;
  idPrefix: string;
  makeId: (label: string) => string;
}): T[] {
  const steps: T[] = [];
  for (let index = 0; index < chainPath.length - 1; index++) {
    steps.push({
      ...baseStep,
      id: makeId(`${idPrefix}-${index}`),
      fromMintUrl: chainPath[index],
      toMintUrl: chainPath[index + 1],
      chainId,
      chainPath: [...chainPath],
      chainHopIndex: index,
    });
  }
  logger.info('mint.rebalance.run_state.chain_steps.result', {
    chainId,
    pathLength: chainPath.length,
    stepCount: steps.length,
    idPrefix,
  });
  return steps;
}
