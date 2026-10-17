import type { CustomSheetId, SheetLayoutConfig } from './types';

export const SHEET_LAYOUT_CONFIG: Record<CustomSheetId, SheetLayoutConfig> = {
  // Generic action-menu auto-fits: typically 1–4 short rows, same as the
  // menu-lane equivalent (`actionMenuPopup` with no footer).
  'action-menu': { mode: 'contentHeight' },
  'send-memo': { mode: 'contentHeight' },
  // Signer sheets auto-fit, but their expandable sections (raw-event Details,
  // the pairing preset list, follow-diff rows) can push past the dynamic-size
  // cap — `scrollable` swaps the clipped BottomSheetView for a gorhom
  // scrollable so the body scrolls instead.
  'signer-approval': { mode: 'contentHeight', scrollable: true },
  'signer-connect': { mode: 'contentHeight', scrollable: true },
  // Only ever pushed inside the signer-connect sheet, so the root's layout
  // governs at runtime; the entry exists because the registry is total.
  'signer-profile-picker': { mode: 'contentHeight', scrollable: true },
  // Tap-to-pay auto-fits: pulsing glyph + two text lines + Close footer.
  'nfc-tap': { mode: 'contentHeight' },
};
