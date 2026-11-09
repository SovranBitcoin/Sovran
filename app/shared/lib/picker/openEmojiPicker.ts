/**
 * @fileoverview Opening the emoji sheet and hearing back which emoji was
 * picked.
 *
 * The sheet is the `emojiPicker` route (`app/emojiPicker.tsx`): the picker
 * sheet's geometry with a grid of its own. Its contents are fixed, so nothing
 * is handed over; the answer is an option whose id is the emoji.
 */

import { createSheetRoute } from './sheetRoute';
import type { PickerSession } from './types';

export const emojiSheet = createSheetRoute<null>('/emojiPicker', {
  show: () => {},
  clear: () => {},
});

export function openEmojiPicker(): PickerSession<null> {
  return emojiSheet.open(null);
}
