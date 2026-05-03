import React, { useCallback, useMemo } from 'react';

import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import type { SwapLeg } from '@/shared/stores/runtime/swapStatusStore';
import { StatusToast, type StatusToastStatus } from './StatusToast';

function legSummary(legs: SwapLeg[]): { doneCount: number; total: number } {
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
  const active = useSwapStatusStore((s) => s.active);
  const groupId = active?.groupId;

  // `swapStatusPopup`'s `onHide` clears `useSwapStatusStore.active` after the
  // dismiss animation, so the action only needs to navigate + hide.
  const onPressView = useCallback(() => {
    if (!groupId) {
      hide();
      return;
    }
    guardedRouter.push({ pathname: '/swap', params: { groupId } });
    hide();
  }, [groupId, hide]);

  const summary = useMemo(() => legSummary(active?.legs ?? []), [active?.legs]);

  if (!active) return null;

  const isDone = active.state === 'done';
  const isFailed = active.state === 'failed';
  const status: StatusToastStatus = isFailed ? 'failed' : isDone ? 'confirmed' : 'pending';
  const title = isFailed ? 'Swap failed' : isDone ? 'Swap complete' : 'Swapping';
  const total = summary.total;
  // Always render "X of Y swaps" so the toast shows progress from the first
  // frame ("0 of 2 swaps") instead of waiting for the first leg to resolve.
  const subtitle = isFailed
    ? (active.errorMessage ?? `${summary.doneCount} of ${total} swaps`)
    : `${isDone ? total : summary.doneCount} of ${total} swaps`;

  return (
    <StatusToast
      status={status}
      title={title}
      subtitle={subtitle}
      action={groupId ? { label: 'View', onPress: onPressView } : undefined}
      toastProps={{ ...toastProps, hide }}
    />
  );
}
