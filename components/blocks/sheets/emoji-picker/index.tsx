/**
 * @fileoverview EmojiPicker Sheet - Encode ecash tokens with Bitcoin emojis
 *
 * @module components/blocks/sheets/emoji-picker
 *
 * @description
 * Single-route sheet displaying 11 Bitcoin-themed emojis. User selects emoji,
 * token is encoded, copied to clipboard, and sheet closes.
 *
 * **Route:** 'emoji-grid' (only route)
 *
 * **Usage:**
 * ```typescript
 * SheetManager.show('emoji-picker', {
 *   payload: { token: getEncodedTokenV4(someToken) }
 * });
 * ```
 *
 * @see {@link registerAllSheets}
 * @see {@link ./routes}
 */

import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { useTheme } from 'providers/ThemeProvider';

/**
 * EmojiPickerSheet Component
 *
 * @component
 * @description Main wrapper - do NOT render directly, use SheetManager.show()
 */
function EmojiPickerSheet(props: any) {
  const { getPrimaryColor } = useTheme();

  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="emoji-grid"
      containerStyle={{ backgroundColor: getPrimaryColor('950') }}
      {...props}
    />
  );
}

/**
 * Registers sheet with react-native-actions-sheet
 *
 * @param {Object} params
 * @param {'global'} [params.context]
 * @returns {Function}
 */
export default ({ context }: { context?: 'global' }) =>
  context
    ? registerSheet(sheetName, EmojiPickerSheet, context)
    : registerSheet(sheetName, EmojiPickerSheet);
