import type { CustomSheetId, SheetLayoutConfig } from './types';

export const SHEET_LAYOUT_CONFIG: Record<CustomSheetId, SheetLayoutConfig> = {
  'profile-switcher': { mode: 'snapPoints', snapPoints: ['80%'] },
  'emoji-picker': { mode: 'snapPoints', snapPoints: ['80%'] },
  'button-handler': { mode: 'snapPoints', snapPoints: ['80%'] },
  'offline-send-suggestions': { mode: 'contentHeight' },
  'offline-send': { mode: 'contentHeight' },
  'mint-select': { mode: 'snapPoints', snapPoints: ['60%'] },
};
