import type { AnnotatedOption, PaymentMachine, StepDataMap } from 'wallet';

import type { ParsedNostrConnectUri } from '@/features/nostrSigner';
import type { ActionMenuItem } from './popups/actionMenu';

/**
 * Generic "pick one of N" menu rendered through the FullWindowOverlay-backed
 * `<BottomSheet>` lane (above route modals). Dispatched by
 * `ActionMenuButton presentation="bottom-sheet"`. Inputs / tabbed sections stay
 * in the `actionMenuPopup` lane — this carries plain buttons only.
 */
type ActionMenuSheetPayload = {
  title?: string;
  buttons: readonly ActionMenuItem[];
};

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

/** No payload — the nfc-tap sheet reads everything from nfcTapStore. */
type NfcTapPayload = Record<string, never>;

/**
 * The approval sheet reads the live NIP-46 pending queue from
 * `useNip46RequestsStore` directly (it advances request-by-request as
 * verdicts land), so the payload carries no request data.
 */
type SignerApprovalPayload = Record<string, never>;

/**
 * Pairing sheet for a scanned/pasted/deep-linked `nostrconnect://` URI. The
 * raw URI (it embeds the pairing secret — never log it) is parsed inside the
 * sheet so every entry point shares one validation path.
 */
type SignerConnectPayload = { uri: string };

/**
 * "Sign In As" page pushed inside the signer-connect sheet (never opened as a
 * root sheet). Carries the already-parsed pairing URI so the picker can hand
 * `(parsed, targetProfile)` to the profile-switch seam. The parsed URI embeds
 * the pairing secret — never log it. Type-only feature import: erased at
 * compile time, so no runtime cycle with the popup module.
 */
type SignerProfilePickerPayload = { parsed: ParsedNostrConnectUri };

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
   * Generic action-menu chooser routed here (FullWindowOverlay) because
   * `ActionMenuButton presentation="bottom-sheet"` callers — e.g. the
   * amount-screen "Next" split button (as Lightning / as Ecash) — live inside
   * `(send-flow)` route modals, where the menu-lane host renders underneath
   * and is invisible. Same above-modal stacking reason as `payment-options`.
   */
  'action-menu': ActionMenuSheetPayload;
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
  /**
   * NIP-46 signer approval prompt. Lives in this lane because a signing
   * request can arrive while ANY surface is up — send-flow route modals,
   * camera, drawer — and the prompt must stack above all of them
   * (FullWindowOverlay), exactly like `payment-options`.
   */
  'signer-approval': SignerApprovalPayload;
  /**
   * NIP-46 pairing review ("Connect App"). Same above-modal stacking
   * requirement: pairing starts from the camera screen, which is itself a
   * route modal that would bury a menu-lane sheet.
   */
  'signer-connect': SignerConnectPayload;
  /**
   * In-sheet profile picker page for the signer-connect flow ("Sign In As").
   * Reached only via `pushCustomPage` from the connect sheet; the id exists
   * here because the custom-page mechanism routes through the same registry.
   */
  'signer-profile-picker': SignerProfilePickerPayload;
  /**
   * Android tap-to-pay surface ("Hold near a payment terminal"). Android has
   * no system NFC sheet, and the wallet NFC button also exists inside
   * send-flow route modals — same above-modal stacking need as the rest of
   * this lane. Phase text is driven by nfcTapStore, not the payload.
   */
  'nfc-tap': NfcTapPayload;
};

/** Payload types for custom action sheets. */
export type ActionSheetPayloads = BaseActionSheetPayloads;
