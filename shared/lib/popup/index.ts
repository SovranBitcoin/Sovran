/**
 * Popup module: toasts, bottom sheets, and declarative icons/amounts.
 *
 * - popup(): low-level engine (runtime error matching + sheet/toast routing)
 * - Named popups: typed functions for every popup scenario (copyPopup, paymentStatusPopup, etc.)
 * - fmt: tagged template for inline amount formatting
 * - resolvePopupIcon: declarative icon resolution (emoji:, icon:, custom:)
 * - registerToast: called once by PopupHost to connect the HeroUI toast manager
 */

export { popup } from './popups/engine';
export { registerToast, setPopupDuration, showActionSheet, showCustomToast } from './popups/bridge';
export type { ActionSheetPayloads } from './popups/bridge';
export { fmt, isAmountSegment } from './format';
export { parsePaymentError } from './parsePaymentError';
export type { PopupTextSegment } from './format';
export { resolvePopupIcon } from './icons';
export type { PopupIcon } from './icons';
export * from './popups/index';
