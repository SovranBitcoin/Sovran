import type { PaymentMachine, StepDataMap } from 'wallet';

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

type SendMemoPayload = StepDataMap['enterSendMemo'] & {
  machine: PaymentMachine;
};

/** No payload — the nfc-tap sheet reads everything from nfcTapStore. */
type NfcTapPayload = Record<string, never>;

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
   * Android tap-to-pay surface ("Hold near a payment terminal"). Android has
   * no system NFC sheet, and the wallet NFC button also exists inside
   * send-flow route modals — same above-modal stacking need as the rest of
   * this lane. Phase text is driven by nfcTapStore, not the payload.
   */
  'nfc-tap': NfcTapPayload;
};

/** Payload types for custom action sheets. */
export type ActionSheetPayloads = BaseActionSheetPayloads;
