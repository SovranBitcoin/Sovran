/**
 * @fileoverview ButtonHandler Sheet - Dynamic button action interface
 *
 * @module components/blocks/sheets/buttonHandler
 *
 * @description
 * Single-route sheet for displaying dynamic button actions with custom animations.
 * Supports async operations, button reordering, and processing states. Used for
 * complex user interactions requiring multiple action options.
 *
 * **Route:** 'route-a' (only route)
 *
 * **Usage:**
 * ```typescript
 * // Open button handler
 * SheetManager.show('button-handler', {
 *   payload: {
 *     buttons: [
 *       { text: 'Save', onPress: async (close) => { /* save logic *\/ close(); } },
 *       { text: 'Cancel', onPress: (close) => close() }
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
 * ButtonHandlerSheet Component
 *
 * @component
 * @description Main wrapper - do NOT render directly, use SheetManager.show()
 */
function SheetWithRouter() {
  const { getPrimaryColor } = useTheme();

  return (
    <ActionSheet
      closeAnimationConfig={{
        damping: 50,
        mass: 0.5,
        stiffness: 200,
        overshootClamping: false,
      }}
      openAnimationConfig={{
        damping: 50,
        mass: 0.5,
        stiffness: 200,
        overshootClamping: false,
      }}
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="route-a"
      containerStyle={{
        backgroundColor: getPrimaryColor('800'),
        flexShrink: 1,
        flexGrow: 0,
        flexBasis: 'auto',
      }}
      gestureEnabled={true}
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
