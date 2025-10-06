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

export default ({ context }: { context?: 'global' }) =>
  context
    ? registerSheet(sheetName, SheetWithRouter, context)
    : registerSheet(sheetName, SheetWithRouter);
