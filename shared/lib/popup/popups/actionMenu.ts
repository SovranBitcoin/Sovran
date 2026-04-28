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
 * Usage (custom header + trailing buttons, e.g. profile switcher):
 *
 *   actionMenuPopup({
 *     title: 'Select profile',
 *     header: <ProfileList ... />,
 *     buttons: [
 *       { text: 'Generate new account', icon: '...', separator: true, onPress: ... },
 *       { text: 'Import Nostr', icon: '...', onPress: () => openImportMenu() },
 *     ],
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
import type { GestureResponderEvent } from 'react-native';

export interface ActionMenuButton {
  text: string;
  icon?: string;
  testID?: string;
  variant?: 'primary' | 'secondary' | 'dangerous';
  /** Disables tap and (when `reason` is set) renders the reason as the description. */
  disabled?: boolean;
  /** Shown as the description when `disabled` is true. */
  reason?: string;
  /** Secondary caption rendered below the label when the button is enabled. */
  description?: string;
  /** Marks this item as failed — disables tap and forces danger styling on the description. */
  isFailed?: boolean;
  /** Render a thin divider above this item. Use for trailing actions like "Change Mint". */
  separator?: boolean;
  /** Trailing content (e.g. an AmountFormatter for BIP321 / proof-selector amounts). */
  suffix?: React.ReactNode;
  /**
   * Skip the host's automatic dismiss after onPress. Use when chaining to another
   * menu via `actionMenuPopup` so the surface swaps content instead of closing.
   */
  keepOpen?: boolean;
  /** Receives a close callback; if omitted the menu closes immediately. */
  onPress?: (close: (event?: GestureResponderEvent) => void) => void | Promise<void>;
}

export interface ActionMenuInput {
  id: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  /** Optional helper text rendered above the input (e.g. context for the field). */
  description?: string;
}

export interface ActionMenuPrimaryActionContext {
  setError: (message: string | null) => void;
  close: () => void;
}

export interface ActionMenuPrimaryAction {
  text: string;
  /** Label shown while the async onPress is pending. Defaults to `text`. */
  loadingText?: string;
  /** Optional leading icon (matches the icon convention on `ActionMenuButton`). */
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
  buttons?: ActionMenuButton[];
  /** Form inputs rendered above the primary action. */
  inputs?: ActionMenuInput[];
  /** Submit button for `inputs`. Required when `inputs` is set. */
  primaryAction?: ActionMenuPrimaryAction;
  /** Fired when the sheet closes without the user picking any item (overlay tap, swipe-down). */
  onDismiss?: () => void;
}

let currentPayload: ActionMenuPayload | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Open the action menu with the given payload. */
export function actionMenuPopup(payload: ActionMenuPayload): void {
  currentPayload = payload;
  emit();
}

/** Dismiss the menu programmatically (the host also dismisses on overlay tap / swipe). */
export function dismissActionMenuPopup(): void {
  if (currentPayload === null) return;
  currentPayload = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ActionMenuPayload | null {
  return currentPayload;
}

/** Hook used by `<ActionMenuHost />` to read the current payload. */
export function useActionMenuPayload(): ActionMenuPayload | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
