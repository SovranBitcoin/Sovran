import { create } from 'zustand';
import type { ReactNode } from 'react';
import type { PopupIcon, PopupTextSegment } from '@/shared/lib/popup';
import type { LiveSheetConfig, LiveSheetStatus } from '@/shared/lib/popup/liveSheetTypes';
import type { ActionSheetPayloads } from '@/shared/lib/popup/actionSheetTypes';

export type SheetButton = {
  text: string;
  page?: string;
  onPress?: () => void;
};

/** Standard popup sheet: icon, title, submessage, buttons */
export type StandardSheetPayload = {
  message: string;
  submessage?: ReactNode | PopupTextSegment[];
  icon?: PopupIcon;
  dismissable?: boolean;
  duration?: number;
  buttons?: SheetButton[];
  onClose?: (data: unknown) => void;
  live?: LiveSheetConfig;
  /** Set by live.get() for styling (e.g. animate to green when confirmed). */
  status?: LiveSheetStatus;
};

/** Custom action sheet: sheetId + typed payload */
export type CustomSheetPayload<K extends keyof ActionSheetPayloads = keyof ActionSheetPayloads> = {
  sheetId: K;
  payload: ActionSheetPayloads[K];
};

export type SheetPayload = StandardSheetPayload | CustomSheetPayload;

export function isCustomSheetPayload(p: SheetPayload | null): p is CustomSheetPayload {
  return p != null && 'sheetId' in p && 'payload' in p;
}

type PopupStore = {
  current: SheetPayload | null;
  isOpen: boolean;
  open: (payload: SheetPayload) => void;
  close: () => void;
  update: (partial: Partial<StandardSheetPayload>) => void;
};

export const usePopupStore = create<PopupStore>((set, get) => ({
  current: null,
  isOpen: false,
  open: (payload) => {
    set({ current: payload, isOpen: true });
  },
  update: (partial) => {
    const { current } = get();
    if (!current || isCustomSheetPayload(current)) return;
    set({ current: { ...current, ...partial } });
  },
  close: () => {
    const { current } = get();
    if (current && !isCustomSheetPayload(current) && current.onClose) {
      try {
        current.onClose({ reason: 'dismiss' });
      } catch (error) {
        console.error('popup onClose callback failed', error);
      }
    }
    set({ current: null, isOpen: false });
  },
}));
