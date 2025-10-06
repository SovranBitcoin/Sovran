import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { useTheme } from 'providers/ThemeProvider';

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

export default ({ context }: { context?: 'global' }) =>
  context
    ? registerSheet(sheetName, SheetWithRouter, context)
    : registerSheet(sheetName, SheetWithRouter);
