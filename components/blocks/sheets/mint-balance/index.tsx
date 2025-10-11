/**
 * @fileoverview MintBalance Sheet - Mint selection and management interface
 *
 * @module components/blocks/sheets/mint-balance
 *
 * @description
 * Multi-route sheet for selecting mints, adding new mints, and viewing mint details.
 * Users can browse owned mints, add discovered mints, and inspect mint information.
 *
 * **Routes:** 'list' (initial), 'add', 'info'
 *
 * **Usage:**
 * ```typescript
 * // Open mint selection
 * SheetManager.show('mint-balance', {
 *   payload: {
 *     requireBalance: true,
 *     showAddMintsButton: true,
 *     onMintPress: (mint, balance) => { /* handle selection *\/ }
 *   }
 * });
 *
 * // Navigate (inside routes)
 * router?.navigate('add');
 * router?.navigate('info', { mintUrl: 'https://mint.example.com' });
 *
 * // Close
 * SheetManager.hide('mint-balance');
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
 * MintBalanceSheet Component
 *
 * @component
 * @description Main wrapper - do NOT render directly, use SheetManager.show()
 */
function MintBalanceSheet(props: any) {
  const { getPrimaryColor } = useTheme();
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="list"
      containerStyle={{
        backgroundColor: getPrimaryColor('950'),
        height: Dimensions.get('screen').height - 32,
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
    ? registerSheet(sheetName, MintBalanceSheet, context)
    : registerSheet(sheetName, MintBalanceSheet);
