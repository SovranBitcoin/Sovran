import { create } from 'zustand';
import type { ReactNode } from 'react';

export type SheetButton = {
  text: string;
  page?: string;
  onPress?: () => void;
};

export type SheetPayload = {
  message: string;
  submessage?: ReactNode;
  icon?: ReactNode;
  emoji?: string;
  dismissable?: boolean;
  duration?: number;
  buttons?: SheetButton[];
  onClose?: (data: unknown) => void;
};

type PopupStore = {
  current: SheetPayload | null;
  isOpen: boolean;
  open: (payload: SheetPayload) => void;
  close: () => void;
};

export const usePopupStore = create<PopupStore>((set, get) => ({
  current: null,
  isOpen: false,
  open: (payload) => {
    set({ current: payload, isOpen: true });
  },
  close: () => {
    const { current } = get();
    if (current?.onClose) {
      try {
        current.onClose({ reason: 'dismiss' });
      } catch (error) {
        console.error('popup onClose callback failed', error);
      }
    }
    set({ current: null, isOpen: false });
  },
}));
