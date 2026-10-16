/**
 * @fileoverview The wallet home's scroll offset, shared across navigators.
 *
 * The wallet's header is transparent so the wallpaper shows through it at
 * rest. Once the page scrolls, content would run under the header controls
 * with nothing between them. The header (owned by the tab's layout) and the
 * scroller (owned by the screen) live in different React trees, so the offset
 * rides one UI-thread shared value: the scroller writes it, the header fades
 * its scrim in from it, and no render happens on either side.
 */

import { makeMutable } from 'react-native-reanimated';

export const walletScrollY = makeMutable(0);

/** Distance scrolled before the header scrim is fully opaque. */
export const WALLET_HEADER_SCRIM_DISTANCE = 24;
