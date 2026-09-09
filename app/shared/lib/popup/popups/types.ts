import type { ReactNode } from 'react';
import type { PopupIcon } from '../icons';
import type { PopupTextSegment } from '../format';
import type { SheetCloseEvent } from '@/shared/stores/runtime/popupStore';
import type { ServiceFailure } from '@/shared/lib/errors';

export type BaseOverrides = {
  duration?: number;
  onOpen?: () => void;
  onClose?: (event: SheetCloseEvent) => void;
};

export type TextOverrides = BaseOverrides & {
  text?: string | ReactNode | PopupTextSegment[];
  failure?: ServiceFailure;
};

export type PopupOverrides = TextOverrides & {
  icon?: PopupIcon;
};
