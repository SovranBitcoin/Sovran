import type { PaymentMachine, StepDataMap } from 'wallet';

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
  /**
   * Called when the sheet is dismissed WITHOUT a button press (swipe-down /
   * overlay tap). Lets a caller that awaits a choice — e.g. the onchain
   * network-fee picker — resolve as "cancelled" instead of hanging.
   */
  onDismiss?: () => void;
};

export type ProfileSwitcherAction =
  | { type: 'switch'; accountIndex: number }
  | { type: 'create' }
  | { type: 'import'; nsec: string; pubkeyHex: string; accountIndex: number };

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
   * and is invisible.
   */
  'action-menu': ActionMenuSheetPayload;
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
   * (FullWindowOverlay).
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
