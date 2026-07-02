/**
 * Pure layout math for `UnderlineTabs` overflow — UI-free so it's testable
 * under the Node jest project (the component itself pulls in uniwind).
 */

/** Minimum label breathing room per side before a tab counts as cramped —
 *  deliberately tight: collapsing a tab into the (…) menu costs more
 *  discoverability than slightly snug labels do. */
const TAB_LABEL_PADDING = 6;
/** Fixed footprint of the trailing overflow (…) button. */
export const MORE_BUTTON_WIDTH = 40;

/**
 * Split the tab list into visible tabs and overflow (menu) tabs. All tabs stay
 * visible while every label fits at its intrinsic width plus padding;
 * otherwise the longest fitting prefix (always at least one tab) keeps the
 * bar and the rest move behind the (…) menu button.
 */
export function partitionTabs(
  tabs: readonly string[],
  labelWidths: Record<string, number>,
  containerWidth: number
): { visible: string[]; overflow: string[] } {
  const widths = tabs.map((tab) => labelWidths[tab]);
  if (containerWidth <= 0 || widths.some((w) => w === undefined)) {
    // Not measured yet — render everything (first frame; measurement follows).
    return { visible: [...tabs], overflow: [] };
  }
  const needed = (w: number) => w + TAB_LABEL_PADDING * 2;
  const total = widths.reduce((sum, w) => sum + needed(w as number), 0);
  if (total <= containerWidth) return { visible: [...tabs], overflow: [] };

  const budget = containerWidth - MORE_BUTTON_WIDTH;
  const visible: string[] = [];
  let used = 0;
  for (let i = 0; i < tabs.length; i++) {
    const w = needed(widths[i] as number);
    if (used + w > budget) break;
    used += w;
    visible.push(tabs[i]);
  }
  if (visible.length === 0) visible.push(tabs[0]);
  return { visible, overflow: tabs.slice(visible.length) };
}
