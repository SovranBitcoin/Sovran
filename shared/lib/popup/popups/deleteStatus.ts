import React from 'react';

import { popupLog } from '@/shared/lib/logger';
import { useDeleteStatusStore } from '@/shared/stores/runtime/deleteStatusStore';

import { DeleteStatusToast } from '../DeleteStatusToast';
import { showCustomToast } from './bridge';

/**
 * Show the post Delete progress toast. The orchestrator
 * (`useDeletePost`) calls `useDeleteStatusStore.start({ legs })` first; the
 * toast subscribes and re-renders as image/relay legs settle. On
 * `complete()` / `fail()` it animates to the terminal state and auto-dismisses
 * 3s later, clearing the store via `onHide`.
 *
 * Idempotent: if a delete toast is already mounted this is a no-op.
 */
let deleteToastMounted = false;

export function deleteStatusPopup(): void {
  if (deleteToastMounted) {
    popupLog.debug('popup.delete_status.skip_already_mounted');
    return;
  }
  deleteToastMounted = true;
  popupLog.info('popup.delete_status.show');
  showCustomToast({
    component: (toastProps) => React.createElement(DeleteStatusToast, toastProps),
    duration: 'persistent',
    onHide: () => {
      deleteToastMounted = false;
      popupLog.info('popup.delete_status.hide');
      useDeleteStatusStore.getState().clear();
    },
  });
}
