import type { Phase, Result } from './LoadingIndicator';

/** Checkpoint status vocabulary shared by TransferStepChain and
 *  HistoryEntryTimeline. Kept here so both consumers map a single domain
 *  status to LoadingIndicator phase/result without duplicating the switch. */
export type CheckpointStatus =
  | 'future'
  | 'future-small'
  | 'next-pending'
  | 'current'
  | 'complete'
  | 'success'
  | 'failed'
  | 'rolled-back'
  | 'already-spent';

export interface IndicatorTuple {
  phase: Phase;
  result: Result;
}

export function mapCheckpointStatusToIndicator(status: CheckpointStatus): IndicatorTuple {
  switch (status) {
    case 'future':
    case 'future-small':
    case 'next-pending':
      return { phase: 'idle', result: 'success' };
    case 'current':
      return { phase: 'loading', result: 'success' };
    case 'complete':
    case 'success':
      return { phase: 'done', result: 'success' };
    case 'failed':
      return { phase: 'done', result: 'error' };
    case 'rolled-back':
    case 'already-spent':
      return { phase: 'done', result: 'reverted' };
  }
}
