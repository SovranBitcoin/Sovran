/**
 * @fileoverview The app's virtualized list. The single seam over the underlying
 * list library (`@shopify/flash-list`).
 *
 * Every plain data list in the app renders through `<List>`. It owns the only
 * import of the underlying list library and applies the app's defaults (hidden
 * scroll indicator, draw distance) so a future list-library swap touches this
 * one file instead of every screen.
 *
 * Specialized surfaces that need full control of the underlying list — the
 * thread reader (anchoring), the chat surface (bottom-stick), the
 * section-anchored picker (sheet scroll injection) and the animated
 * transaction timeline — render FlashList directly rather than through `<List>`.
 */
import type { Ref } from 'react';
import {
  FlashList as BaseFlashList,
  type FlashListProps,
  type FlashListRef,
} from '@shopify/flash-list';
import { withUniwind } from 'uniwind';

/**
 * Uniwind patches `className` onto React Native's own components, but not onto
 * third-party ones — FlashList is not RN core, so its `*Style` props have no
 * class equivalent out of the box. `withUniwind` supplies them: every `xStyle`
 * prop gains an `xClassName` counterpart, resolved against the same theme
 * variables `useThemeColor` reads.
 *
 * Wrapping happens here, at the seam that already owns the only FlashList
 * import for plain lists, so no caller needs to know the wrapper exists.
 */
const FlashList = withUniwind(BaseFlashList) as typeof BaseFlashList;

/** Class-string counterparts `withUniwind` adds to FlashList's style props. */
type ListClassNameProps = {
  contentContainerClassName?: string;
  ListHeaderComponentClassName?: string;
  ListFooterComponentClassName?: string;
};

/**
 * Default over-render window (px). FlashList v2 measures synchronously, so this
 * only governs how far ahead it renders; 250 keeps a couple of screens of
 * lookahead without inflating the JS workload during fast scroll.
 */
const DEFAULT_DRAW_DISTANCE = 250;

export function List<T>({
  showsVerticalScrollIndicator = false,
  drawDistance = DEFAULT_DRAW_DISTANCE,
  // Android: opt into the nested-scroll protocol by default so a list rendered
  // inside a native form-sheet is recognised as the sheet's scrolling child —
  // otherwise dragging the list down (to scroll up) dismisses the sheet. It's a
  // no-op when the list isn't nested in another scrollable, and ignored on iOS.
  nestedScrollEnabled = true,
  ...props
}: FlashListProps<T> & ListClassNameProps & { ref?: Ref<FlashListRef<T>> }) {
  return (
    <FlashList
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      drawDistance={drawDistance}
      nestedScrollEnabled={nestedScrollEnabled}
      {...props}
    />
  );
}
