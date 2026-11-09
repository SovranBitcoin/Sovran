/**
 * Imperative action-menu popup — the canonical "pick one of N" surface across
 * the app. Dispatches a payload that `<ActionMenuHost />` renders as a
 * heroui-native Menu in bottom-sheet mode.
 *
 * Usage (plain):
 *
 *   actionMenuPopup({
 *     title: 'Insufficient balance',
 *     buttons: [
 *       { text: 'Top Up', onPress: (close) => { close(); openTopUp(); } },
 *       { text: 'Cancel', variant: 'secondary', onPress: (close) => close() },
 *     ],
 *   });
 *
 * Usage (with amount suffixes + per-item failure state, e.g. BIP321 picker):
 *
 *   actionMenuPopup({
 *     title: 'Choose how to pay',
 *     onDismiss: () => machine.dismiss?.(),
 *     buttons: options.map((opt) => ({
 *       text: 'Lightning',
 *       icon: 'mdi:lightning-bolt',
 *       suffix: <AmountFormatter amount={opt.amount} unit={unit} />,
 *       isFailed: opt.failed,
 *       disabled: opt.disabled,
 *       reason: opt.reason,
 *       onPress: () => machine.chooseOption(opt.option),
 *     })),
 *   });
 *
 * Usage (input form, e.g. import nsec):
 *
 *   actionMenuPopup({
 *     title: 'Import Nostr',
 *     inputs: [{ id: 'nsec', label: 'nsec', placeholder: 'nsec1...', secureTextEntry: true }],
 *     primaryAction: {
 *       text: 'Import',
 *       loadingText: 'Importing...',
 *       isDisabled: (values) => !values.nsec.trim(),
 *       onPress: async (values, { setError, close }) => {
 *         const err = await tryImport(values.nsec);
 *         if (err) setError(err); else close();
 *       },
 *     },
 *   });
 */

import { useSyncExternalStore } from 'react';
import type React from 'react';
import type { TextInputProps } from 'react-native';

import { log } from '@/shared/lib/logger';

const actionMenuLog = log.child({ module: 'actionMenu' });

export interface ActionMenuItem {
  text: string;
  icon?: string;
  /** Custom leading glyph node (takes precedence over `icon`). Use when the
   * row needs an avatar / emoji / non-iconify visual. */
  iconNode?: React.ReactNode;
  /** Stable e2e selector derived from what the item does or the entity it
   * picks (e.g. `mint-picker-${mintUrl}`) — never its position or label. */
  testID: string;
  /** Optional stable spoken name when the visual title differs by platform
   * (for example Android's "British Pound" vs iOS's native "GBP"). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  variant?: 'primary' | 'secondary' | 'dangerous';
  /** Marks the current choice in a pick-one-of-N menu. Exposed to screen
   * readers as the checked state; any visual mark stays in `suffix`. */
  selected?: boolean;
  /** Disables tap and (when `reason` is set) renders the reason as the description. */
  disabled?: boolean;
  /** Shown as the description when `disabled` is true. */
  reason?: string;
  /** Secondary caption rendered below the label when the button is enabled. */
  description?: string;
  /** Tints the row yellow: the option works but carries a caveat worth reading first. */
  isCaution?: boolean;
  /** Marks this item as failed — disables tap and forces danger styling on the description. */
  isFailed?: boolean;
  /** Render a thin divider above this item. Use for trailing actions like "Change Mint". */
  separator?: boolean;
  /** Trailing content (e.g. an AmountFormatter for BIP321 / proof-selector amounts). */
  suffix?: React.ReactNode;
  /**
   * Skip the host's automatic dismiss after onPress. Use when chaining to another
   * menu via `replaceActionMenuPopup` so the surface swaps content instead of closing.
   */
  keepOpen?: boolean;
  /**
   * Receives close(afterClose?) to queue a successor until native close completes.
   * Unless keepOpen is set, the host starts closing before invoking onPress.
   *
   * Race note: tapping a button commits the host's "user picked" flag
   * synchronously, before this `onPress` resolves. If the user then taps
   * the overlay (or swipes the sheet down) while `onPress` is still
   * pending, `ActionMenuPayload.onDismiss` does NOT fire — the host
   * treats the in-flight selection as the terminal user action. Wire any
   * "user explicitly dismissed mid-action" handling into the body of
   * `onPress` itself rather than relying on `onDismiss`.
   */
  onPress?: (close: (afterClose?: () => void) => void) => void | Promise<void>;
}

export interface ActionMenuInput {
  id: string;
  label?: string;
  /** Spoken field name when there is no visible `label` (the placeholder is
   *  an example value, not a name). */
  accessibilityLabel?: string;
  placeholder?: string;
  initialValue?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  /** Optional helper text rendered above the input (e.g. context for the field). */
  description?: string;
}

interface ActionMenuPrimaryActionContext {
  setError: (message: string | null) => void;
  /**
   * Dismiss the menu. When a successor is provided, the host invokes it only
   * after the native bottom sheet reports that its close has completed.
   */
  close: (afterClose?: () => void) => void;
}

export interface ActionMenuPrimaryAction {
  text: string;
  /** Label shown while the async onPress is pending. Defaults to `text`. */
  loadingText?: string;
  /** Optional leading icon (matches the icon convention on `ActionMenuItem`). */
  icon?: string;
  testID?: string;
  isDisabled?: (values: Record<string, string>) => boolean;
  onPress: (
    values: Record<string, string>,
    ctx: ActionMenuPrimaryActionContext
  ) => void | Promise<void>;
}

export interface ActionMenuPayload {
  /** Rendered as `Menu.Label` at the top of the sheet. */
  title?: string;
  /** Custom content rendered between the title and any items / inputs. */
  header?: React.ReactNode;
  buttons?: ActionMenuItem[];
  /**
   * Buttons pinned at the bottom of the sheet (with a gradient/blur fade
   * above them so the scrollable content visibly disappears beneath).
   * Rendered after `inputs` and `primaryAction`. Use for affordances that
   * should always be reachable regardless of scroll position — e.g.
   * "New conversation" under a long list of AI conversations.
   *
   * When set, the menu's body becomes a scroll container capped at ~85%
   * of the viewport. When unset, the menu auto-fits content as before.
   */
  footerButtons?: ActionMenuItem[];
  /** Form inputs rendered above the primary action. */
  inputs?: ActionMenuInput[];
  /** Submit button for `inputs`. Required when `inputs` is set. */
  primaryAction?: ActionMenuPrimaryAction;
  /**
   * Override the sheet's snap point. Defaults: `'60%'` when there's a sticky
   * footer, otherwise dynamic-sized to content.
   */
  snapPoint?: string;
  /** Fired when the sheet closes without the user picking any item (overlay tap, swipe-down). */
  onDismiss?: () => void;
}

interface ActionMenuSnapshot {
  payload: ActionMenuPayload | null;
  seq: number;
}

let snapshot: ActionMenuSnapshot = { payload: null, seq: 0 };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Open the action menu with the given payload. */
export function actionMenuPopup(payload: ActionMenuPayload): void {
  actionMenuLog.info('actionMenu.dispatch', {
    hadPayload: snapshot.payload !== null,
    buttons: payload.buttons?.length ?? 0,
    footerButtons: payload.footerButtons?.length ?? 0,
    inputs: payload.inputs?.length ?? 0,
    snapPoint: payload.snapPoint,
    listeners: listeners.size,
  });
  snapshot = { payload, seq: snapshot.seq + 1 };
  emit();
}

/** Replace a keepOpen menu in place, preserving its native presentation. */
export function replaceActionMenuPopup(payload: ActionMenuPayload): void {
  snapshot = { payload, seq: snapshot.seq };
  emit();
}

/** Dismiss the menu programmatically (the host also dismisses on overlay tap / swipe). */
export function dismissActionMenuPopup(): void {
  if (snapshot.payload === null) return;
  actionMenuLog.info('actionMenu.dismiss');
  snapshot = { payload: null, seq: snapshot.seq };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Read at native/async callback time so an old instance cannot dismiss a new request. */
export function getActionMenuSnapshot(): ActionMenuSnapshot {
  return snapshot;
}

/** Hook used by `<ActionMenuHost />` to read the current payload. */
export function useActionMenuPayload(): ActionMenuSnapshot {
  return useSyncExternalStore(subscribe, getActionMenuSnapshot, getActionMenuSnapshot);
}
