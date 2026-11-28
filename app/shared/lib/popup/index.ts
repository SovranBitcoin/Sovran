/**
 * Popup module: toasts, bottom sheets, and declarative icons/amounts.
 *
 * - popup(): low-level engine (runtime error matching + sheet/toast routing)
 * - Named popups: typed functions for every popup scenario (copyPopup, staticPopup, etc.)
 * - fmt: tagged template for inline amount formatting
 * - resolvePopupIcon: declarative icon resolution (emoji:, icon:, custom:)
 */

export { popup } from './popups/engine';
export { showActionSheet } from './popups/bridge';
export type { ActionSheetPayloads } from './actionSheetTypes';
export { isAmountSegment } from './format';
export type { PopupTextSegment } from './format';
export { resolvePopupIcon } from './icons';
export type { PopupIcon } from './icons';
export * from './popups/index';
