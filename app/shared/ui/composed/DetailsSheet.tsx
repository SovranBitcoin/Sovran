import { isValidElement, useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { GroupedTable } from '@/shared/ui/composed/GroupedTable';
import { Screen } from '@/shared/ui/composed/Screen';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';

/**
 * What a row is about. The page is read by context, not top to bottom: who it
 * was with, what the token can do, which mint, then the strings to quote in a
 * bug report. Listed in the order the groups are drawn.
 */
const DETAIL_GROUPS = [
  'Payment',
  'People',
  'Lock',
  'Token',
  'Mint',
  'References',
  'Debug',
] as const;
export type DetailGroup = (typeof DETAIL_GROUPS)[number];

export interface DetailsSheetItem {
  title: string;
  value: ReactNode;
  /** Which group the row sits in. Unset, a short fact is part of the payment
   *  and a long string is a reference. */
  group?: DetailGroup;
  /** Monospace the value. Unset, any long unbroken string is. */
  mono?: boolean;
  /**
   * What copying this row puts on the clipboard, for a value that is drawn
   * rather than written (a row of icons). Every row has to be copyable: this
   * page is where a payment is read out for debugging.
   */
  copyText?: string;
  /**
   * The value is money to whoever holds it: an unredeemed ecash token. It
   * copies from its own row, on purpose, and is left out of Copy all, which
   * is what gets pasted into a bug report.
   */
  bearer?: boolean;
  direction?: 'row' | 'column';
}

interface DetailsSheetContentProps {
  onClose: () => void;
  items: readonly DetailsSheetItem[];
}

/** Longer than this and a value reads better on its own line. */
const INLINE_VALUE_MAX = 22;
const COPIED_MS = 1500;

/** The plain text of a value, when it has one: a string, or a `CopyableValue`. */
function textOf(value: ReactNode): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  // `CopyableValue`, `MiddleEllipsisValue` and anything like them: an element
  // that shows a shortened form of the full string it was given as `value`.
  if (isValidElement<{ value?: unknown }>(value) && typeof value.props.value === 'string') {
    return value.props.value;
  }
  return null;
}

/** What a row copies: its own text, or the text it was given to stand for it. */
export const copyTextOf = (entry: DetailsSheetItem): string | null =>
  entry.copyText ?? textOf(entry.value);

function detailRow(entry: DetailsSheetItem) {
  const text = textOf(entry.value);
  const copyText = copyTextOf(entry);
  // A fact with no value is not a fact worth a row.
  if (text === '') return null;
  return (
    <GroupedTable.Row
      key={entry.title}
      testID={`details-row-${entry.title.toLowerCase().replace(/\s+/g, '-')}`}
      label={entry.title}
      value={text ?? entry.value}
      copyText={copyText ?? undefined}
      copyable={copyText !== null}
      stacked={isStacked(entry)}
      mono={entry.mono ?? isMachineString(text)}
    />
  );
}

/** A value too long to sit beside its label: an id, a quote, an invoice. */
function isStacked(entry: DetailsSheetItem): boolean {
  return entry.direction === 'column' || (textOf(entry.value)?.length ?? 0) > INLINE_VALUE_MAX;
}

/** A key, id, hash, invoice or URL: long, with no spaces. Read character by
 *  character, so it is set in the monospace face. */
function isMachineString(text: string | null): boolean {
  return text !== null && text.length > INLINE_VALUE_MAX && !/\s/.test(text);
}

const groupOf = (entry: DetailsSheetItem): DetailGroup =>
  entry.group ?? (isStacked(entry) ? 'References' : 'Payment');

/**
 * The detail items as one table per group; text values copy on tap.
 *
 * A single group is drawn bare, with no heading: a heading over the only
 * thing on the page says nothing.
 */
export function DetailsTable({ items }: { items: readonly DetailsSheetItem[] }) {
  const groups = DETAIL_GROUPS.map((group) => ({
    group,
    rows: items.filter((entry) => groupOf(entry) === group),
  })).filter(({ rows }) => rows.length > 0);
  return (
    <GroupedTable>
      {groups.map(({ group, rows }) => (
        <GroupedTable.Section key={group} {...(groups.length > 1 ? { title: group } : {})}>
          {rows.map(detailRow)}
        </GroupedTable.Section>
      ))}
    </GroupedTable>
  );
}

/**
 * Everything known about one payment, as a table: the content of the Details
 * modal (`app/details.tsx`).
 *
 * An ordinary screen: the route's native header carries the title and the way
 * out, like every other screen in the app, and the footer is the shared one.
 * Copy all takes every text value at once, Done closes. A row whose value is
 * text also copies on tap. The copy confirmation is drawn on the button
 * itself, since the app's toasts sit beneath a system sheet.
 */
export function DetailsSheetContent({ onClose, items }: DetailsSheetContentProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  useEffect(() => {
    if (!copiedAll) return;
    const timer = setTimeout(() => setCopiedAll(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copiedAll]);

  const copyable = items
    .filter((entry) => !entry.bearer)
    .map((entry) => ({ title: entry.title, text: copyTextOf(entry) }))
    .filter((row) => row.text !== null && row.text.length > 0);

  const copyAll = async () => {
    await Clipboard.setStringAsync(copyable.map((row) => `${row.title}: ${row.text}`).join('\n'));
    void EnhancedHaptics.copyHaptic();
    setCopiedAll(true);
  };

  return (
    <Screen
      name="DetailsScreen"
      footer={
        <BottomButtons>
          <ButtonHandler
            buttons={[
              {
                text: copiedAll ? 'Copied' : 'Copy all',
                variant: 'secondary',
                testID: 'details-sheet-copy-all',
                onPress: copyAll,
                condition: copyable.length > 1,
              },
              {
                text: 'Done',
                variant: 'primary',
                testID: 'details-sheet-done',
                onPress: onClose,
              },
            ]}
          />
        </BottomButtons>
      }>
      {/* No gutter of its own: the screen wrapper already insets its content,
          and a second one left the table visibly narrower than every other
          page. */}
      <View testID="details-sheet">
        <DetailsTable items={items} />
      </View>
    </Screen>
  );
}
