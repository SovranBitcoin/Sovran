import type { AnnotatedOption, PaymentMachine, StepDataMap } from '@sovranbitcoin/colada';

export type ProfileSwitcherAction =
  | { type: 'switch'; accountIndex: number }
  | { type: 'create' }
  | { type: 'import'; nsec: string; pubkeyHex: string; accountIndex: number };

type EmojiPickerPayload = { token: string };

type ModelPickerPayload = Record<string, never>;

type PaymentOptionsPayload = {
  options: readonly AnnotatedOption[];
  unit: string;
  machine: PaymentMachine;
  onDismiss?: () => void;
};

type PaymentFallbackPayload = PaymentOptionsPayload & {
  failedOptionValues: readonly string[];
  lastFailedMessage?: string;
};

type ProofSelectorPayload = StepDataMap['chooseProofs'] & {
  machine: PaymentMachine;
};

type SendMemoPayload = StepDataMap['enterSendMemo'] & {
  machine: PaymentMachine;
};

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
  /**
   * "Choose how to pay" — pick one of N detected payment methods (Lightning,
   * Cashu, etc.) for a scanned destination. Lives in this lane because the
   * QR-scan camera screen inside `(send-flow)` is itself an iOS route modal;
   * the menu-lane (heroui `<Menu>` with `disableFullWindowOverlay`) renders
   * in the root window and stacks *under* the camera, hiding the picker.
   * The standalone `<BottomSheet>` path here uses FullWindowOverlay and
   * mounts above route modals.
   */
  'payment-options': PaymentOptionsPayload;
  /**
   * Fallback variant — same surface as `payment-options`, but seeded with
   * the failed attempt so the broken row renders red. Routed here for the
   * same above-modal stacking reason.
   */
  'payment-fallback': PaymentFallbackPayload;
  /**
   * "Choose amount" — round-up / round-down / change-mint suggestions when
   * the entered amount doesn't compose exactly from available proofs. Fires
   * from the send-flow amount screen, which is itself an iOS route modal;
   * the menu lane would render below it. Same above-modal stacking reason
   * as `payment-options`.
   */
  'proof-selector': ProofSelectorPayload;
  /**
   * Optional memo before creating an ecash token. This is reached from the
   * send-flow amount route, which is itself an iOS route modal, so it needs
   * the same FullWindowOverlay-backed lane as the other send-flow sheets.
   */
  'send-memo': SendMemoPayload;
};

/** Payload types for custom action sheets. */
export type ActionSheetPayloads = BaseActionSheetPayloads;
