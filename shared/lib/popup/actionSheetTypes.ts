type EmojiPickerPayload = { token: string };

/**
 * Addressable custom sheet IDs. Nested pages that only exist inside a sheet flow
 * should stay internal to that sheet.
 *
 * Only full-body layouts live here; pick-one-of-N menus (and input forms via
 * `actionMenuPopup`'s `inputs` / `primaryAction` slots) go through
 * `actionMenuPopup` (see shared/lib/popup/popups/actionMenu.ts) and render on
 * the shared heroui `Menu presentation="bottom-sheet"` surface.
 */
type BaseActionSheetPayloads = {
  'emoji-picker': EmojiPickerPayload;
};

/** Payload types for custom action sheets. */
export type ActionSheetPayloads = BaseActionSheetPayloads;
