import type { ReactNode } from 'react';
import type { PopupIcon } from '../icons';
import type { PopupTextSegment } from '../format';

export type BaseOverrides = {
  duration?: number;
  onOpen?: () => void;
  onClose?: (data: unknown) => void;
};

export type TextOverrides = BaseOverrides & {
  text?: string | ReactNode | PopupTextSegment[];
};

export type PopupOverrides = TextOverrides & {
  icon?: PopupIcon;
};
