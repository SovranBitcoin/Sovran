export type ProfileSwitcherAction =
  | { type: 'switch'; accountIndex: number }
  | { type: 'create' }
  | { type: 'import'; nsec: string; pubkeyHex: string; accountIndex: number };

type EmojiPickerPayload = { token: string };

type ModelPickerPayload = Record<string, never>;

/**
 * Addressable custom sheet IDs. Nested pages that only exist inside a sheet flow
 * should stay internal to that sheet.
 *
 * Sheets here render through `PopupHost` on heroui's standalone
 * `<BottomSheet>` (FullWindowOverlay enabled by default — appears above
 * iOS route modals). Pick-one-of-N menus and short input-form menus go
 * through `actionMenuPopup` instead, which uses heroui `<Menu>` (no FWO,
 * for keyboard avoidance) — but heroui Menu in bottom-sheet presentation
 * silently fails to mount under FWO, so any surface that needs
 * above-modal stacking must live here.
 */
type BaseActionSheetPayloads = {
  /**
   * Tabbed emoji picker invoked from inside the Send Ecash route modal.
   * Lives here because heroui Menu in FWO mode doesn't render visibly —
   * verified by tracing `actionMenu.dispatch` → `actionMenuHost.payload
   * {open: true}` followed by no openChange and no visual mount. The
   * heroui standalone `<BottomSheet>` path (this one) is the only known-
   * working surface that stacks above iOS route modals.
   */
  'emoji-picker': EmojiPickerPayload;
  /**
   * AI tab model picker. Lives in this lane (not `actionMenuPopup` with
   * sections) because the UX is *filter-by-tab*, not scroll-to-section:
   * tapping the OpenAI tab should hide the Claude / Grok rows entirely,
   * which `SectionAnchorList` (the actionMenu sections renderer) can't
   * do. The body keeps its own active-provider state and re-derives the
   * row list on each tab switch — see `ModelPickerContent`.
   */
  'model-picker': ModelPickerPayload;
};

/** Payload types for custom action sheets. */
export type ActionSheetPayloads = BaseActionSheetPayloads;
