import React from 'react';

import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { popupLog } from '@/shared/lib/logger';

import { StatusToast } from '../StatusToast';
import { showCustomToast } from './bridge';

/**
 * Toast shown after a note is published optimistically. "View" opens the
 * thread, which renders instantly from `ownContentStore` (the note is local
 * before it has round-tripped through relays/nagg).
 */
export function notePublishedPopup(payload: { eventId: string }): void {
  const { eventId } = payload;
  popupLog.info('popup.note_published.show', { eventIdLength: eventId.length });
  showCustomToast({
    component: (toastProps) =>
      React.createElement(StatusToast, {
        status: 'confirmed',
        title: 'Posted',
        action: {
          label: 'View',
          onPress: () => {
            guardedRouter.push({ pathname: '/(user-flow)/thread', params: { eventId } });
            toastProps.hide?.();
          },
        },
        debugFields: { eventId },
        toastProps,
      }),
    duration: 3000,
    debugLabel: 'note-published',
    debugFields: { eventId },
  });
}
