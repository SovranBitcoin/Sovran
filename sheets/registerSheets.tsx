/**
 * @deprecated Action sheets now use the popup system via showActionSheet.
 * Import { showActionSheet } from '@/shared/lib/popup' to open sheets.
 * No registration needed — PopupHost renders custom sheet content.
 */
export function registerAllSheets(_params?: { context?: 'global' }) {
  // No-op: sheets are rendered by PopupHost when showActionSheet is called
}
