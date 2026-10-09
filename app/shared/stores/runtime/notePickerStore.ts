import { defineStore as create } from '@/shared/lib/persist/defineStore';

/** What the note picker was opened for. */
interface NotePickerRequest {
  /** The value of every note held at the mint being sent from. */
  notes: readonly number[];
  unit: string;
  /** The amount on the keypad when the picker opened; 0 when empty. */
  amount: number;
  /** Called with the total of the picked notes when the sender confirms. */
  onUse: (total: number) => void;
}

/**
 * The note picker's hand-off.
 *
 * The picker is a route, and a route's params are strings: it cannot carry
 * the list of notes or the callback that puts the total back on the keypad.
 * Runtime only: it describes one open picker and means nothing once that
 * picker has closed.
 */
interface NotePickerState {
  request: NotePickerRequest | null;
  present: (request: NotePickerRequest) => void;
  clear: () => void;
}

export const useNotePickerStore = create<NotePickerState>({
  name: 'useNotePickerStore',
  scope: 'session',
})((set) => ({
  request: null,
  present: (request) => set({ request }),
  clear: () => set({ request: null }),
}));
