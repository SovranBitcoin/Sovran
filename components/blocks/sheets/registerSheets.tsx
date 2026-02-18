import { default as registerPopup } from 'components/blocks/sheets/popup';
import { default as registerButtonHandler } from 'components/blocks/sheets/buttonHandler';
import { default as registerEmojiPicker } from 'components/blocks/sheets/emoji-picker';
import { default as registerProfileSwitcher } from 'components/blocks/sheets/profileSwitcher';

/**
 * Registers all application sheets with the react-native-actions-sheet system.
 *
 * This function is the central registration point for all sheet components
 * used throughout the Sovran application. It registers sheets for various
 * functionalities including popups, mint operations, button handlers,
 * transaction messages, emoji picker, and balance displays.
 *
 * The function should be called during app initialization to make all sheets
 * available via SheetManager.show() throughout the application.
 *
 * @param {Object} params - Registration parameters
 * @param {'global'} [params.context] - Optional context for global registration
 * @returns {void}
 *
 * @example
 * // Call during app initialization (typically in App.tsx or _layout.tsx)
 * import { registerAllSheets } from './components/blocks/sheets/registerSheets';
 *
 * // Register all sheets
 * registerAllSheets({ context: 'global' });
 *
 * // Now all sheets are available via SheetManager
 * SheetManager.show('emoji-picker', { payload: { token: 'some-token' } });
 * SheetManager.show('popup', { payload: { message: 'Hello!' } });
 *
 * @see {@link SheetManager.show}
 * @see {@link https://github.com/ammarahm-ed/react-native-actions-sheet}
 */
export function registerAllSheets({ context }: { context?: 'global' }) {
  registerPopup({ context });
  registerButtonHandler({ context });
  registerEmojiPicker({ context });
  registerProfileSwitcher({ context });
}
