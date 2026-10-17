import type { ReactNode } from 'react';

import type { ListRowAvatar, ListRowIcon } from '@/shared/ui/composed/ListRow';

/** What sits at the start of a row: a person or thing's picture, an icon, or anything else. */
export type PickerLeading = { avatar: ListRowAvatar } | { icon: ListRowIcon } | { node: ReactNode };

export interface PickerOption {
  id: string;
  title: string;
  description?: string;
  leading?: PickerLeading;
  /** Drawn at the end of the row, before the check. */
  trailing?: ReactNode;
  /** The current choice: drawn with a check and announced as selected. */
  selected?: boolean;
  /** Shown dimmed and cannot be picked; `reason` says why, under the title. */
  disabled?: boolean;
  reason?: string;
  /** A choice that loses something, drawn in the danger colour. */
  isCaution?: boolean;
  testID: string;
}

/** A group of options, drawn as a tab. A tab with no options is left out. */
export interface PickerSection {
  id: string;
  title: string;
  icon?: string;
  /** e2e selector for the tab (default: `picker-tab-${id}`). */
  testID?: string;
  options: readonly PickerOption[];
}

/** A footer button: something to do instead of picking a row. */
export interface PickerAction {
  id: string;
  title: string;
  icon?: string;
  variant?: 'primary' | 'secondary';
  testID: string;
}

export interface PickerRequest {
  /** The sheet's header title. */
  title: string;
  /** Rows split into tabs. Takes the place of `options` when set. */
  sections?: readonly PickerSection[];
  options?: readonly PickerOption[];
  actions?: readonly PickerAction[];
  /** e2e selector for the list (the sheet itself is always `picker-sheet`). */
  testID?: string;
}

export type PickerResult =
  { kind: 'option'; id: string } | { kind: 'action'; id: string } | { kind: 'dismissed' };

/** One open picker, as its opener holds it. */
export interface PickerSession<Request = PickerRequest> {
  /**
   * The person's answer. A row or footer button resolves it at the tap; it
   * resolves `dismissed` when the sheet goes without one (pulled down, the
   * close or back button) or another picker takes its place.
   */
  result: Promise<PickerResult>;
  /**
   * Resolves once the sheet has gone from the screen. Wait for it before
   * opening a popup, which would otherwise paint beneath a closing iPhone
   * sheet, or before navigating.
   */
  closed: Promise<void>;
  /** Replaces what the sheet shows. Does nothing once the answer is in or another picker has taken over. */
  update: (request: Request) => void;
}
