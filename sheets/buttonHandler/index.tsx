/**
 * @fileoverview ButtonHandler Sheet - Dynamic button action interface
 *
 * @description
 * Single-route sheet for displaying dynamic button actions. Use buttonHandlerPopup
 * from @/shared/lib/popup to open.
 *
 * **Usage:**
 * ```typescript
 * import { buttonHandlerPopup } from '@/shared/lib/popup';
 *
 * buttonHandlerPopup({
 *   buttons: [
 *     { text: 'Save', onPress: async (close) => { close(); } },
 *     { text: 'Cancel', onPress: (close) => close() }
 *   ]
 * });
 * ```
 */

export { ButtonHandlerContent } from './routes/routeA';
