/**
 * Custom sheet content components for action sheets.
 * Rendered by PopupHost when showActionSheet is called.
 *
 * Note: pick-one-of-N menus and input-form menus dispatch through
 * `actionMenuPopup` (shared/lib/popup/popups/actionMenu.ts) and render on the
 * shared heroui `Menu presentation="bottom-sheet"` surface via
 * `<ActionMenuHost />`. Only layouts that surface can't express belong here
 * (e.g. emoji-picker's search input + snapPoint height).
 */

export { EmojiPickerContent } from './emoji-picker';
