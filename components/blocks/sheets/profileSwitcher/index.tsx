/**
 * @fileoverview ProfileSwitcher Sheet - Multi-account profile switching
 *
 * @module components/blocks/sheets/profileSwitcher
 *
 * @description
 * Sheet for switching between profiles and adding new ones.
 * Displays a vertical list of profiles with avatars and usernames,
 * and a "New Profile" action at the bottom.
 *
 * **Route:** 'profile-list' (only route)
 *
 * **Usage:**
 * ```typescript
 * SheetManager.show('profile-switcher', {
 *   payload: {
 *     onSwitchProfile: (accountIndex) => { ... },
 *     onAddProfile: () => { ... },
 *   }
 * });
 * ```
 *
 * @see {@link registerAllSheets}
 */

import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { useTheme } from 'providers/ThemeProvider';

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
      initialRoute="profile-list"
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

export default ({ context }: { context?: 'global' }) =>
  context
    ? registerSheet(sheetName, SheetWithRouter, context)
    : registerSheet(sheetName, SheetWithRouter);
