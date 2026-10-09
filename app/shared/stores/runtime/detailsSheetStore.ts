import { defineStore as create } from '@/shared/lib/persist/defineStore';

import type { DetailsSheetItem } from '@/shared/ui/composed/DetailsSheet';

/**
 * What the Details modal is showing.
 *
 * The modal is a route, and a route's params are strings. A detail row's value
 * can be an element (a copyable value, an icon row), so the rows are handed
 * over here instead. Runtime only: it describes one open modal and means
 * nothing once that modal has closed.
 */
interface DetailsSheetState {
  title: string;
  items: readonly DetailsSheetItem[];
  /** Which `DetailsSection` opened the modal, so only it keeps the rows fresh. */
  owner: string | null;
  present: (owner: string, title: string, items: readonly DetailsSheetItem[]) => void;
  update: (owner: string, items: readonly DetailsSheetItem[]) => void;
  clear: () => void;
}

export const useDetailsSheetStore = create<DetailsSheetState>({
  name: 'useDetailsSheetStore',
  scope: 'session',
})((set, get) => ({
  title: 'Details',
  items: [],
  owner: null,
  present: (owner, title, items) => set({ owner, title, items }),
  update: (owner, items) => {
    if (get().owner === owner) set({ items });
  },
  clear: () => set({ owner: null, items: [] }),
}));
