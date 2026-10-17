/**
 * @fileoverview Opening the picker sheet and hearing back from it.
 *
 * The sheet is the `picker` route (`app/picker.tsx`); `createSheetRoute` owns
 * its lifecycle. The rows go over in `pickerSheetStore`, since a route's
 * params are strings.
 */

import { usePickerSheetStore } from '@/shared/stores/runtime/pickerSheetStore';

import { createSheetRoute } from './sheetRoute';
import type { PickerRequest, PickerSession } from './types';

export const pickerSheet = createSheetRoute<PickerRequest>('/picker', {
  show: (request) => usePickerSheetStore.getState().show(request),
  clear: () => usePickerSheetStore.getState().clear(),
});

/** Show `request` in the picker sheet. */
export function openPicker(request: PickerRequest): PickerSession {
  return pickerSheet.open(request);
}

/**
 * The id of the row picked, or `null` when the sheet went without one. For a
 * picker with no footer buttons whose choice is acted on at the tap.
 */
export async function pickOption(request: PickerRequest): Promise<string | null> {
  const result = await openPicker(request).result;
  return result.kind === 'option' ? result.id : null;
}
