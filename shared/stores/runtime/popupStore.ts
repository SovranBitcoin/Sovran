import { create } from 'zustand';
import type { ReactNode } from 'react';
import { redactError, storeLog } from '@/shared/lib/logger';
import type { PopupIcon, PopupTextSegment } from '@/shared/lib/popup';
import type { LiveSheetConfig, LiveSheetStatus } from '@/shared/lib/popup/liveSheetTypes';
import type { ActionSheetPayloads } from '@/shared/lib/popup/actionSheetTypes';

type SheetButton = {
  text: string;
  page?: string;
  onPress?: () => void;
};

/**
 * Why each onClose fires. `dismiss` = user-driven close. `replaced` = another
 * sheet opened on top before this one was closed. `destroyed` = forced teardown
 * (e.g. profile transition; PopupHost unmounts the native overlay).
 */
type SheetCloseReason = 'dismiss' | 'replaced' | 'destroyed';

export type SheetCloseEvent = { reason: SheetCloseReason };

/** Standard popup sheet: icon, title, submessage, buttons */
export type StandardSheetPayload = {
  message: string;
  submessage?: ReactNode | PopupTextSegment[];
  icon?: PopupIcon;
  dismissable?: boolean;
  duration?: number;
  buttons?: SheetButton[];
  /** Lay buttons side by side ('row') instead of the default vertical stack. */
  buttonLayout?: 'row' | 'stack';
  onClose?: (event: SheetCloseEvent) => void;
  live?: LiveSheetConfig;
  /** Set by live.get() for styling (e.g. animate to green when confirmed). */
  status?: LiveSheetStatus;
};

/** Custom action sheet: sheetId + typed payload */
type CustomSheetPayload<K extends keyof ActionSheetPayloads = keyof ActionSheetPayloads> = {
  sheetId: K;
  payload: ActionSheetPayloads[K];
};

type SheetPayload = StandardSheetPayload | CustomSheetPayload;

export function isCustomSheetPayload(p: SheetPayload | null): p is CustomSheetPayload {
  return p != null && 'sheetId' in p && 'payload' in p;
}

type PopupStore = {
  current: SheetPayload | null;
  isOpen: boolean;
  /** When true, PopupHost must fully unmount the BottomSheet tree to tear down native overlays. */
  destroyed: boolean;
  open: (payload: SheetPayload) => void;
  close: () => void;
  /** Like close(), but also sets `destroyed` so PopupHost unmounts the BottomSheet (and its FullWindowOverlay). */
  destroySheet: () => void;
  update: (partial: Partial<StandardSheetPayload>) => void;
};

export const usePopupStore = create<PopupStore>((set, get) => {
  const fireOnClose = (reason: SheetCloseReason) => {
    const { current } = get();
    if (!current || isCustomSheetPayload(current) || !current.onClose) return;
    try {
      current.onClose({ reason });
    } catch (error) {
      storeLog.error('store.popup.on_close_failed', {
        reason,
        error: redactError(error),
      });
    }
  };

  return {
    current: null,
    isOpen: false,
    destroyed: false,
    open: (payload) => {
      storeLog.info(
        'store.popup.open',
        isCustomSheetPayload(payload) ? { sheetId: payload.sheetId } : { message: payload.message }
      );
      // Honour the "every onClose fires exactly once" contract: if a standard
      // sheet is already open, fire its onClose with `replaced` before the
      // new payload overwrites `current`.
      fireOnClose('replaced');
      set({ current: payload, isOpen: true, destroyed: false });
    },
    update: (partial) => {
      const { current } = get();
      if (!current || isCustomSheetPayload(current)) return;
      storeLog.debug('store.popup.update');
      set({ current: { ...current, ...partial } });
    },
    close: () => {
      storeLog.debug('store.popup.close');
      fireOnClose('dismiss');
      set({ current: null, isOpen: false });
    },
    destroySheet: () => {
      storeLog.debug('store.popup.destroy');
      fireOnClose('destroyed');
      set({ current: null, isOpen: false, destroyed: true });
    },
  };
});
