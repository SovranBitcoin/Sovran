/**
 * @fileoverview Delete Sheet - Profile deletion confirmation
 *
 * @module components/blocks/sheets/delete
 *
 * @description
 * Single-route sheet for confirming profile deletion. Displays warnings about
 * data loss and mnemonic recovery limitations. Performs complete app reset on confirmation.
 *
 * **Route:** 'route-a' (only route)
 *
 * **Usage:**
 * ```typescript
 * // Open deletion confirmation
 * SheetManager.show('delete-router');
 *
 * // No return value - performs destructive action
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
 * DeleteSheet Component
 *
 * @component
 * @description Main wrapper - do NOT render directly, use SheetManager.show()
 */
function SheetWithRouter() {
  const { getPrimaryColor } = useTheme();
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="route-a"
      containerStyle={{
        backgroundColor: getPrimaryColor('800'),
        flexShrink: 1,
        flexGrow: 0,
        flexBasis: 'auto',
      }}
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
    ? registerSheet(sheetName, SheetWithRouter, context)
    : registerSheet(sheetName, SheetWithRouter);
