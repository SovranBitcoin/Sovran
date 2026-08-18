import { useShallow } from 'zustand/react/shallow';
import opacity from 'hex-color-opacity';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useDeleteStatusStore } from '@/shared/stores/runtime/deleteStatusStore';
import type { ProgressLeg } from '@/shared/stores/runtime/legProgress';
import { StatusToast, type StatusToastStatus } from './StatusToast';

const RING_SIZE = 40;

/** Legs that have reached a terminal state advance the ring, success or not. */
function settledCount(legs: ProgressLeg[] | undefined): { settled: number; total: number } {
  if (!legs) return { settled: 0, total: 0 };
  let settled = 0;
  for (const l of legs) {
    if (l.status === 'done' || l.status === 'failed' || l.status === 'skipped') settled += 1;
  }
  return { settled, total: legs.length };
}

type DeleteStatusToastProps = {
  hide: (ids?: string | string[] | 'all') => void;
  [key: string]: unknown;
};

/**
 * Multi-stage Delete toast: a red segmented ring (one segment per image + per
 * relay) over a "Deleting post" / "Post deleted" / "Delete failed" line. Mirrors
 * `SwapStatusToast` but reskins the indicator red and shows the ring instead of
 * the plain spinner. Subscribes to `useDeleteStatusStore`; the orchestrator in
 * `useDeletePost` drives the legs.
 */
export function DeleteStatusToast({ hide, ...toastProps }: DeleteStatusToastProps) {
  // Completing a deletion is a success — fill the ring + tick green. A total
  // failure (every relay rejected) flips StatusToast to its own red error
  // state, so the red lives there, not in the progress ring.
  const [success, muted] = useThemeColor(['success', 'muted'] as const);

  const view = useDeleteStatusStore(
    useShallow((s) =>
      s.active
        ? {
            present: true as const,
            state: s.active.state,
            errorMessage: s.active.errorMessage,
            ...settledCount(s.active.legs),
          }
        : { present: false as const }
    )
  );

  if (!view.present) return null;

  const isDone = view.state === 'done';
  const isFailed = view.state === 'failed';
  const isCancelled = view.state === 'cancelled';
  const status: StatusToastStatus =
    isFailed || isCancelled ? 'failed' : isDone ? 'confirmed' : 'pending';
  const title = isCancelled
    ? 'Delete cancelled'
    : isFailed
      ? 'Delete failed'
      : isDone
        ? 'Post deleted'
        : 'Deleting post';
  const subtitle =
    isFailed || isCancelled
      ? (view.errorMessage ?? `${view.settled} of ${view.total} steps`)
      : `${isDone ? view.total : view.settled} of ${view.total} steps`;

  return (
    <StatusToast
      status={status}
      title={title}
      subtitle={subtitle}
      indicatorSize={RING_SIZE}
      segmentedProgress={{ completedSegments: view.settled, segmentCount: view.total }}
      ringColor={opacity(muted, 0.3)}
      ringSuccessColor={success}
      toastProps={{ ...toastProps, hide }}
    />
  );
}
