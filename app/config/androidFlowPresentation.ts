/**
 * @fileoverview How each modal flow presents on Android.
 *
 * iOS presents every flow as a page sheet, and Android used to copy that: a
 * full-height native bottom sheet, dragged down to dismiss. That is the wrong
 * surface for most of them there. Material reserves a modal bottom sheet for a
 * menu or a simple choice; a task with several steps, a keyboard and a pinned
 * confirm button is a screen, entered and left with Back. A full-height sheet
 * also puts a drag-to-dismiss gesture on top of a scrolling payment flow, so a
 * downward fling on a list can throw the payment away.
 *
 * So on Android a flow is a pushed screen unless it is listed here as a sheet.
 * This module is the one owner of that decision: `config/modalScreens.ts`
 * reads it to present the route, and `AndroidSheetFlowStack` (flow groups) and
 * `FormSheetChrome` (standalone routes) read it to choose the matching chrome:
 * the JS sheet header, or the native one.
 * iOS is unaffected.
 */

type AndroidFlowPresentation = 'sheet' | 'screen';

/**
 * Routes that stay bottom sheets on Android: short, single-purpose surfaces a
 * person picks from or confirms and leaves, with no step after them. Flow
 * groups are named with their parentheses; standalone routes by file name.
 */
const SHEET_ROUTES: ReadonlySet<string> = new Set(['(filter-flow)', '(prompt-flow)', 'share']);

/** How the flow group or standalone route `name` presents on Android. */
export function androidFlowPresentation(name: string): AndroidFlowPresentation {
  return SHEET_ROUTES.has(name) ? 'sheet' : 'screen';
}
