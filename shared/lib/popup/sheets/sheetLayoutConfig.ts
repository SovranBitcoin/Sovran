import type { CustomSheetId, SheetLayoutConfig } from './types';

export const SHEET_LAYOUT_CONFIG: Record<CustomSheetId, SheetLayoutConfig> = {
  'emoji-picker': { mode: 'snapPoints', snapPoints: ['80%'] },
};
