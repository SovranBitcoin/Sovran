/**
 * @fileoverview Popup Sheet - Toast notifications and alerts
 *
 * @module components/blocks/sheets/popup
 *
 * @description
 * Single-route sheet for displaying toast notifications, alerts, and temporary messages.
 * Supports auto-dismiss, modal mode, and custom buttons with navigation.
 *
 * **Route:** 'route-a' (only route)
 *
 * **Usage:**
 * ```typescript
 * // Show toast notification
 * SheetManager.show('popup-sheet', {
 *   payload: {
 *     variant: 'toast',
 *     emoji: '🎉',
 *     message: 'Success!',
 *     submessage: 'Operation completed'
 *   }
 * });
 *
 * // Show modal with buttons
 * SheetManager.show('popup-sheet', {
 *   payload: {
 *     variant: 'modal',
 *     message: 'Confirm Action',
 *     buttons: [
 *       { text: 'Cancel', onPress: () => {} },
 *       { text: 'Confirm', page: 'settings' }
 *     ]
 *   }
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
 * PopupSheet Component
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
        flexShrink: 1,
        flexGrow: 0,
        flexBasis: 'auto',
        backgroundColor: getPrimaryColor('800'),
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
