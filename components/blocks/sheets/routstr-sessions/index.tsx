/**
 * @fileoverview RoutstrSessions Sheet - Session management interface
 *
 * @module components/blocks/sheets/routstr-sessions
 *
 * @description
 * Single-route sheet for managing Routstr chat sessions.
 * Users can view all sessions, switch between them, and create new ones.
 *
 * **Route:** 'list' (only route)
 *
 * **Usage:**
 * ```typescript
 * // Open sessions panel
 * SheetManager.show('routstr-sessions', {
 *   payload: {}
 * });
 *
 * // Get selected session
 * const result = await SheetManager.show('routstr-sessions');
 * // result.payload.sessionId
 * ```
 *
 * @see {@link registerAllSheets}
 * @see {@link ./routes}
 */

import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Dimensions } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';

/**
 * RoutstrSessionsSheet Component
 *
 * @component
 * @description Main wrapper - do NOT render directly, use SheetManager.show()
 */
function RoutstrSessionsSheet(props: any) {
  const { getPrimaryColor } = useTheme();
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="list"
      containerStyle={{
        backgroundColor: getPrimaryColor('950'),
        height: Dimensions.get('screen').height * 0.8,
      }}
      safeAreaInsets={{ ...useSafeAreaInsets(), bottom: 0, top: 0 }}
      gestureEnabled={true}
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
    ? registerSheet(sheetName, RoutstrSessionsSheet, context)
    : registerSheet(sheetName, RoutstrSessionsSheet);

