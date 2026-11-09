import { defineStore as create } from '@/shared/lib/persist/defineStore';

import type { PickerRequest } from '@/shared/lib/picker/types';

/**
 * What the picker sheet is showing.
 *
 * The sheet is a route, and a route's params are strings. A picker's rows
 * carry pictures and elements, so `openPicker` hands them over here instead.
 * Runtime only: it describes one open sheet and means nothing once that sheet
 * has closed. Who may change it is `openPicker`'s business, not the store's.
 */
interface PickerSheetState {
  request: PickerRequest | null;
  show: (request: PickerRequest) => void;
  clear: () => void;
}

export const usePickerSheetStore = create<PickerSheetState>({
  name: 'usePickerSheetStore',
  scope: 'session',
})((set) => ({
  request: null,
  show: (request) => set({ request }),
  clear: () => set({ request: null }),
}));
