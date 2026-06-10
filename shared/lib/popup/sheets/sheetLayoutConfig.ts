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
  'proof-selector': { mode: 'contentHeight' },
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
};
