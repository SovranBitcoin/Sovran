import type { ReactNode } from 'react';
import type { PopupIcon } from '../icons';
import type { PopupTextSegment } from '../format';
import type { SheetCloseEvent } from '@/shared/stores/runtime/popupStore';

export type BaseOverrides = {
  duration?: number;
  onOpen?: () => void;
  onClose?: (event: SheetCloseEvent) => void;
};

export type TextOverrides = BaseOverrides & {
  text?: string | ReactNode | PopupTextSegment[];
};

export type PopupOverrides = TextOverrides & {
  icon?: PopupIcon;
};
