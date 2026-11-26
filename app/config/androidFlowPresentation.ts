/**
 * @fileoverview Which single-screen routes are bottom sheets on Android.
 *
 * iOS presents flows and most standalone routes as page sheets, and Android
 * used to copy that: a full-height native bottom sheet, dragged down to
 * dismiss. That is the wrong surface for most of them there. Material reserves
 * a modal bottom sheet for a menu or a simple choice; a task with several
 * steps, a keyboard and a pinned confirm button is a screen, entered and left
 * with Back. A full-height sheet also puts a drag-to-dismiss gesture on top of
 * a scrolling payment flow, so a downward fling on a list can throw the
 * payment away.
 *
 * So on Android every flow stack is a pushed screen, and a standalone route is
 * one too unless it is listed here as a sheet (ADR 0025). This module is the
 * one owner of that list: `config/modalScreens.ts` reads it to present the
 * route, and `FormSheetChrome` reads it to draw the sheet's header, or none.
 * iOS is unaffected.
 */

type AndroidFlowPresentation = 'sheet' | 'screen';

/**
 * Routes that stay bottom sheets on Android: short, single-purpose surfaces a
 * person picks from or confirms and leaves, named by file. A step after one
 * (the backup a prompt starts) is a pushed screen over it.
 */
const SHEET_ROUTES: ReadonlySet<string> = new Set(['filters', 'cta', 'cta-sample', 'share']);

/** How the root route `name` presents on Android. */
export function androidFlowPresentation(name: string): AndroidFlowPresentation {
  return SHEET_ROUTES.has(name) ? 'sheet' : 'screen';
}
