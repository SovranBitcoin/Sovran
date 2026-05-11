import type { CustomSheetId, SheetLayoutConfig } from './types';

export const SHEET_LAYOUT_CONFIG: Record<CustomSheetId, SheetLayoutConfig> = {
  'emoji-picker': { mode: 'snapPoints', snapPoints: ['80%'] },
  // Model picker is short — title + tab strip + three tier rows. 50% gives
  // headroom for the unaffordable-row "Top up X sats" reason line without
  // looking sparse on tall devices.
  'model-picker': { mode: 'snapPoints', snapPoints: ['50%'] },
  // Payment options auto-fit: typical N is 1–3 rows, and the menu-lane
  // equivalent (`actionMenuPopup` with no footer) also uses dynamic sizing.
  'payment-options': { mode: 'contentHeight' },
  'payment-fallback': { mode: 'contentHeight' },
};
