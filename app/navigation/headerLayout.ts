import { useWindowDimensions } from 'react-native';

import { headerButtonSize } from '@/shared/styles/tokens';

/** Bar edge margin: UIKit's layout margin and the Toolbar content inset are both 16. */
const HEADER_EDGE_INSET = 16;
/** Space a bar keeps between neighbouring items, and between an item and the title. */
const HEADER_ITEM_GAP = 8;
/** Beyond this a title reads as a sentence; it also bounds titles in narrow iPad sheets. */
const HEADER_TITLE_WIDTH_CAP = 220;
/**
 * Room a title keeps however crowded the sides get: the identity icon plus a
 * short name. Three actions on a narrow screen leave less symmetric space than
 * this; there the title keeps its room and gives up the centre line.
 */
export const HEADER_TITLE_MIN_WIDTH = headerButtonSize * 2;

/**
 * Widest a custom header title can be and still sit on the screen's centre line.
 *
 * UINavigationBar, AndroidX Toolbar and FlowSheetHeader all centre a title in the
 * bar only while it clears the items on BOTH sides. react-native-screens sizes the
 * title view in a `space-between` row, so it may grow to the bar minus whatever
 * each side happens to hold; the native bar then slides a title that no longer
 * fits the symmetric space toward the emptier side. That is the off-centre title
 * with one side empty or two actions on one side.
 *
 * So the budget mirrors the busier side onto both: `sideActions` is the larger
 * number of header actions on either side of the title.
 */
export function centeredTitleMaxWidth(windowWidth: number, sideActions: number): number {
  const reserved = HEADER_EDGE_INSET + sideActions * (headerButtonSize + HEADER_ITEM_GAP);
  const symmetric = windowWidth - 2 * reserved;
  return Math.min(HEADER_TITLE_WIDTH_CAP, Math.max(HEADER_TITLE_MIN_WIDTH, symmetric));
}

export function useCenteredTitleMaxWidth(sideActions = 1): number {
  const { width } = useWindowDimensions();
  return centeredTitleMaxWidth(width, sideActions);
}
