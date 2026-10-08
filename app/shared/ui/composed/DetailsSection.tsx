import { useEffect, useId } from 'react';
import { View } from 'react-native';
import Icon from 'assets/icons';

import { Log } from '@/shared/lib/logger';
import { useStylePaint } from '@/shared/styles/appStyle';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { useDetailsSheetStore } from '@/shared/stores/runtime/detailsSheetStore';
import {
  copyTextOf,
  DetailsTable,
  type DetailsSheetItem,
} from '@/shared/ui/composed/DetailsSheet';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';

interface SectionItem extends DetailsSheetItem {
  align?: 'left' | 'right';
}

interface DetailsSectionProps {
  /**
   * Rows to show. Falsy entries are dropped, so callers can inline
   * `condition && { title, value }` without compacting the array themselves.
   */
  items: (SectionItem | false | 0 | '' | null | undefined)[];
  /** Label for the row that opens the modal, and the modal's title. */
  label?: string;
  /** Show the table in place, with no sheet. For previews. */
  initialExpanded?: boolean;
  /**
   * Where the modal is opened from. `inline` (the default) draws a row in the
   * page. `none` draws nothing: the screen opens it from somewhere else, such
   * as a footer button, by setting `open`. The modal is a route and closes
   * itself, so `onOpenChange(false)` is called as soon as it has been
   * presented: `open` is a request to show it, not a record that it is showing.
   */
  trigger?: 'inline' | 'none';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** e2e selector for the inline row (default: `details-section-toggle`). */
  testID?: string;
}

/**
 * The technical facts of a payment: ids, quote, mint, state. Kept off the page
 * and one tap away, in a modal (`app/details.tsx`) where every value can be
 * copied.
 */
export function DetailsSection({
  items,
  label = 'Details',
  initialExpanded = false,
  trigger = 'inline',
  open,
  onOpenChange,
  testID = 'details-section-toggle',
}: DetailsSectionProps) {
  const paint = useStylePaint();
  const owner = useId();
  // First row with a title wins: screens append the shared debug rows after
  // their own, and a screen's own wording for a fact should not be doubled.
  const seen = new Set<string>();
  const rows = items.filter((item): item is SectionItem => {
    if (!item || seen.has(item.title)) return false;
    seen.add(item.title);
    return true;
  });
  const present = () => {
    if (rows.length === 0) return;
    useDetailsSheetStore.getState().present(owner, label, rows);
    router.push('/details');
  };

  // The effects below fire on a change of `open` or of what the rows say, and
  // need this render's rows and callbacks when they do — without re-firing
  // because those are new objects every render.
  const latest = useLatestRef({ present, onOpenChange, rows });

  // A footer button asks for the modal by setting `open`.
  useEffect(() => {
    if (!open) return;
    latest.current.present();
    latest.current.onOpenChange?.(false);
  }, [open, latest]);

  // While this section's modal is up, what it shows follows the payment: a
  // state or a confirmation count that changes underneath changes there too.
  // Read as the modal reads it: a value drawn as an element (an id shown
  // shortened, a row of icons) changes underneath like any other.
  const signature = rows.map((row) => `${row.title}=${copyTextOf(row) ?? ''}`).join('|');
  useEffect(() => {
    useDetailsSheetStore.getState().update(owner, latest.current.rows);
  }, [owner, signature, latest]);

  if (rows.length === 0) return null;

  if (initialExpanded) {
    return (
      <Log name="DetailsSection">
        <View style={{ paddingHorizontal: paint.style.space.gutter }}>
          <DetailsTable items={rows} />
        </View>
      </Log>
    );
  }

  return (
    <Log name="DetailsSection">
      {trigger === 'inline' ? (
        <Pressable
          onPress={present}
          className="flex-row items-center justify-between"
          style={{
            minHeight: paint.style.size.control,
            paddingHorizontal: paint.style.space.gutter,
          }}
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint="Opens every detail of this payment">
          <Text size={16} semibold color={paint.text.secondary}>
            {label}
          </Text>
          <Icon name="mdi:chevron-right" color={paint.text.tertiary} size={20} />
        </Pressable>
      ) : null}
    </Log>
  );
}
