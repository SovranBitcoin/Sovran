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
import { FlashList, type FlashListProps, type FlashListRef } from '@shopify/flash-list';

/**
 * Default over-render window (px). FlashList v2 measures synchronously, so this
 * only governs how far ahead it renders; 250 keeps a couple of screens of
 * lookahead without inflating the JS workload during fast scroll.
 */
const DEFAULT_DRAW_DISTANCE = 250;

export function List<T>({
  showsVerticalScrollIndicator = false,
  drawDistance = DEFAULT_DRAW_DISTANCE,
  ...props
}: FlashListProps<T> & { ref?: Ref<FlashListRef<T>> }) {
  return (
    <FlashList
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      drawDistance={drawDistance}
      {...props}
    />
  );
}
