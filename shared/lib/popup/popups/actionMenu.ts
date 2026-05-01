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
 * Usage (tabbed sections — pick-one-of-N grouped by category):
 *
 *   actionMenuPopup({
 *     title: 'Select profile',
 *     sections: [
 *       { id: 'imported', anchor: { icon: 'mdi:download', label: 'Imported' },
 *         buttons: importedProfileButtons },
 *       { id: 'derived', anchor: { icon: 'mdi:source-branch', label: 'Derived' },
 *         buttons: derivedProfileButtons },
 *     ],
 *     footerButtons: [{ text: 'Generate new account', icon: '...', onPress: ... }],
 *   });
 *
 * Usage (tabbed sections with custom bodies + search, e.g. emoji picker):
 *
 *   actionMenuPopup({
 *     title: 'Emoji',
 *     snapPoint: '80%',
 *     searchable: {
 *       placeholder: 'Search emoji...',
 *       renderResults: (q) => <EmojiGrid emojis={searchEmojis(q)} ... />,
 *     },
 *     sections: CATEGORIES.map((cat) => ({
 *       id: cat.id,
 *       anchor: { icon: <Text>{cat.icon}</Text>, label: cat.label },
 *       renderBody: () => <EmojiGrid emojis={cat.emojis} ... />,
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
import type { GestureResponderEvent } from 'react-native';

import { log } from '@/shared/lib/logger';

const actionMenuLog = log.child({ module: 'actionMenu' });

export interface ActionMenuButton {
  text: string;
  icon?: string;
  /** Custom leading glyph node (takes precedence over `icon`). Use when the
   * row needs an avatar / emoji / non-iconify visual — e.g. profile rows in
   * the profile switcher menu. */
  iconNode?: React.ReactNode;
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

/**
 * A scroll-to-section group within a tabbed menu. Each section gets a pill in
 * the horizontal anchor bar above the scroll viewport; tapping the pill
 * scrolls the body to the section, and the active pill highlights as the
 * user scrolls. Reuses `SectionAnchorList` under the hood.
 *
 * Provide `buttons` for a vertical list of `Menu.Item`s (the profile-switcher
 * pattern), or `renderBody` for arbitrary content like an emoji grid. When
 * both are set, `renderBody` wins.
 */
export interface ActionMenuSection {
  id: string;
  anchor: { icon?: React.ReactNode; label: string; testID?: string };
  buttons?: ActionMenuButton[];
  renderBody?: () => React.ReactNode;
}

/**
 * Search support for tabbed menus. The host owns the input state and renders
 * a `BottomSheetTextInput` above the anchor bar; while the query is non-empty
 * the sections + tab bar hide and `renderResults(query)` becomes the body.
 * Return `null` (or omit `renderResults`) to keep showing the section list
 * regardless of input — useful when the caller wants the input as filter only.
 */
export interface ActionMenuSearchable {
  placeholder?: string;
  renderResults?: (query: string) => React.ReactNode | null;
}

export interface ActionMenuPayload {
  /** Rendered as `Menu.Label` at the top of the sheet. */
  title?: string;
  /** Custom content rendered between the title and any items / inputs. */
  header?: React.ReactNode;
  buttons?: ActionMenuButton[];
  /**
   * Buttons pinned at the bottom of the sheet (with a gradient/blur fade
   * above them so the scrollable content visibly disappears beneath).
   * Rendered after `inputs` and `primaryAction`. Use for affordances that
   * should always be reachable regardless of scroll position — e.g.
   * "Generate new account" / "Import Nostr" on the profile switcher
   * where the scrollable header can be tall.
   *
   * When set, the menu's body becomes a scroll container capped at ~85%
   * of the viewport. When unset, the menu auto-fits content as before.
   */
  footerButtons?: ActionMenuButton[];
  /** Form inputs rendered above the primary action. */
  inputs?: ActionMenuInput[];
  /** Submit button for `inputs`. Required when `inputs` is set. */
  primaryAction?: ActionMenuPrimaryAction;
  /**
   * Tabbed scroll-to-section groups. When set, the menu body becomes a
   * scrollable section list with a horizontal anchor bar above it (same
   * `SectionAnchorList` primitive used elsewhere). Mutually exclusive with
   * top-level `buttons` / `inputs` for the body region — those are still
   * supported for legacy single-list menus.
   */
  sections?: ActionMenuSection[];
  /** Adds a search input above the anchor bar. Has no effect without `sections`. */
  searchable?: ActionMenuSearchable;
  /**
   * Override the sheet's snap point. Defaults: `'60%'` when there's a sticky
   * footer or sections, otherwise dynamic-sized to content. Useful for tabbed
   * pickers that need taller real estate (`'80%'`).
   */
  snapPoint?: string;
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
  actionMenuLog.info('actionMenu.dispatch', {
    title: payload.title,
    hadPayload: currentPayload !== null,
    sections: payload.sections?.length ?? 0,
    buttons: payload.buttons?.length ?? 0,
    footerButtons: payload.footerButtons?.length ?? 0,
    inputs: payload.inputs?.length ?? 0,
    hasSearchable: !!payload.searchable,
    snapPoint: payload.snapPoint,
    listeners: listeners.size,
  });
  currentPayload = payload;
  emit();
}

/** Dismiss the menu programmatically (the host also dismisses on overlay tap / swipe). */
export function dismissActionMenuPopup(): void {
  if (currentPayload === null) return;
  actionMenuLog.info('actionMenu.dismiss', { title: currentPayload.title });
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
