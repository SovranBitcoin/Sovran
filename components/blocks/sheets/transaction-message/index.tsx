/**
 * @fileoverview TransactionMessage Sheet - Optional message input for transactions
 *
 * @module components/blocks/sheets/transaction-message
 *
 * @description
 * Single-route sheet for adding optional messages to transactions. Users can
 * enter a note or skip the message entirely. Returns confirmation action and message text.
 *
 * **Route:** 'message-input' (only route)
 *
 * **Usage:**
 * ```typescript
 * // Open message input
 * const result = await SheetManager.show('transaction-message');
 *
 * // Handle result
 * if (result?.action === 'confirm') {
 *   console.log('Message:', result.message);
 * } else if (result?.action === 'skip') {
 *   console.log('Skipped message');
 * } else {
 *   console.log('Sheet closed without action');
 * }
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
 * TransactionMessageSheet Component
 *
 * @component
 * @description Main wrapper - do NOT render directly, use SheetManager.show()
 */
function TransactionMessageSheet(props: any) {
  const { getPrimaryColor } = useTheme();
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      gestureEnabled={true}
      routes={routes}
      initialRoute="message-input"
      containerStyle={{
        backgroundColor: getPrimaryColor('800'),
        flexShrink: 1,
        flexGrow: 0,
        flexBasis: 'auto',
      }}
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
    ? registerSheet(sheetName, TransactionMessageSheet, context)
    : registerSheet(sheetName, TransactionMessageSheet);
