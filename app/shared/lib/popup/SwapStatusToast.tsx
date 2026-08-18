import { useCallback, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import type { ProgressLeg } from '@/shared/stores/runtime/legProgress';
import { popupLog } from '@/shared/lib/logger';
import { StatusToast, type StatusToastStatus } from './StatusToast';

function legSummary(legs: ProgressLeg[] | undefined): { doneCount: number; total: number } {
  if (!legs) return { doneCount: 0, total: 0 };
  let doneCount = 0;
  for (const l of legs) {
    if (l.status === 'done' || l.status === 'skipped') doneCount += 1;
  }
  return { doneCount, total: legs.length };
}

type SwapStatusToastProps = {
  /** Coming from the toast manager. */
  hide: (ids?: string | string[] | 'all') => void;
  [key: string]: unknown;
};

export function SwapStatusToast({ hide, ...toastProps }: SwapStatusToastProps) {
  // Per-leg setters in `swapStatusStore` build a fresh `active` object on every
  // status flip. Selecting just the fields the toast actually reads (with shallow
  // equality) means identity-stable transitions don't re-render this surface
  // while a multi-leg swap is in flight.
  const view = useSwapStatusStore(
    useShallow((s) =>
      s.active
        ? {
            present: true as const,
            state: s.active.state,
            errorMessage: s.active.errorMessage,
            groupId: s.active.meta.groupId,
            ...legSummary(s.active.legs),
          }
        : { present: false as const }
    )
  );

  // `swapStatusPopup`'s `onHide` clears `useSwapStatusStore.active` after the
  // dismiss animation, so the action only needs to navigate + hide.
  const groupId = view.present ? view.groupId : undefined;
  const onPressView = useCallback(() => {
    if (!groupId) {
      hide();
      return;
    }
    guardedRouter.push({ pathname: '/swap', params: { groupId } });
    hide();
  }, [groupId, hide]);

  // The swap store slot is populated (`start()`) before `swapStatusPopup()`
  // pops this toast, so a missing slot means it was cleared out from under a
  // still-mounted persistent toast (e.g. terminal `onHide` raced, or the store
  // reset). Rendering `null` here would leave an EMPTY toast slab pinned on
  // screen forever (heroui keeps the slot until it's explicitly hidden). Hide
  // it instead of lingering as a contentless duplicate.
  const isPresent = view.present;
  useEffect(() => {
    if (isPresent) return;
    popupLog.info('popup.swap_status.self_dismiss_no_state');
    hide();
  }, [isPresent, hide]);

  if (!view.present) return null;

  const isDone = view.state === 'done';
  const isFailed = view.state === 'failed';
  const isCancelled = view.state === 'cancelled';
  // 'cancelled' shares the failed visual + auto-dismiss path so StatusToast's
  // isTerminal check (status === 'confirmed' || status === 'failed') flips and
  // the toast doesn't sit on 'Swapping' forever after the user presses Stop.
  const status: StatusToastStatus =
    isFailed || isCancelled ? 'failed' : isDone ? 'confirmed' : 'pending';
  const title = isCancelled
    ? 'Swap cancelled'
    : isFailed
      ? 'Swap failed'
      : isDone
        ? 'Swap complete'
        : 'Swapping';
  const total = view.total;
  // Always render "X of Y swaps" so the toast shows progress from the first
  // frame ("0 of 2 swaps") instead of waiting for the first leg to resolve.
  const subtitle =
    isFailed || isCancelled
      ? (view.errorMessage ?? `${view.doneCount} of ${total} swaps`)
      : `${isDone ? total : view.doneCount} of ${total} swaps`;

  return (
    <StatusToast
      status={status}
      title={title}
      subtitle={subtitle}
      action={view.groupId ? { label: 'View', onPress: onPressView } : undefined}
      toastProps={{ ...toastProps, hide }}
    />
  );
}
