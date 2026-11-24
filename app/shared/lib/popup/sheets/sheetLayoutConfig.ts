import type { CustomSheetId, SheetLayoutConfig } from './types';

export const SHEET_LAYOUT_CONFIG: Record<CustomSheetId, SheetLayoutConfig> = {
  // Generic action-menu auto-fits: typically 1–4 short rows, same as the
  // menu-lane equivalent (`actionMenuPopup` with no footer).
  'action-menu': { mode: 'contentHeight' },
  'send-memo': { mode: 'contentHeight' },
  // Tap-to-pay auto-fits: pulsing glyph + two text lines + Close footer.
  'nfc-tap': { mode: 'contentHeight' },
};
