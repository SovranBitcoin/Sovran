/**
 * @fileoverview RoutstrModels Sheet - Model selection interface
 *
 * @module components/blocks/sheets/routstr-models
 *
 * @description
 * Single-route sheet for selecting AI models for Routstr chat.
 * Users can browse available models with pricing and select one.
 *
 * **Route:** 'list' (only route)
 *
 * **Usage:**
 * ```typescript
 * // Open model selector
 * SheetManager.show('routstr-models', {
 *   payload: {}
 * });
 *
 * // Get selected model
 * const result = await SheetManager.show('routstr-models');
 * // result.payload.modelId
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
 * RoutstrModelsSheet Component
 *
 * @component
 * @description Main wrapper - do NOT render directly, use SheetManager.show()
 */
function RoutstrModelsSheet(props: any) {
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
    ? registerSheet(sheetName, RoutstrModelsSheet, context)
    : registerSheet(sheetName, RoutstrModelsSheet);

