import type { ReactNode } from 'react';
import type { PopupIcon } from './icons';
import type { PopupTextSegment } from './format';

export type LiveSheetStatus = 'pending' | 'confirmed' | 'failed';

/** Return type for LiveSheetConfig.get() — partial sheet display values. */
export type LiveSheetGetResult = Partial<{
  submessage: ReactNode | PopupTextSegment[];
  icon: PopupIcon;
  message: string;
  duration: number;
  buttons: { text: string; page?: string; onPress?: () => void }[];
  status: LiveSheetStatus;
}>;

export type LiveSheetConfig = {
  /** Returns current display values. Called on subscribe notify. */
  get: () => LiveSheetGetResult;
  /** Subscribe to data changes. Return unsubscribe. */
  subscribe: (onUpdate: () => void) => () => void;
};
