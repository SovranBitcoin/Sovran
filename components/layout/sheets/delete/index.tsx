import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useSelector } from 'react-redux';

function SheetWithRouter() {
  const theme = useSelector(memoizedGetTheme);
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="route-a"
      containerStyle={{
        backgroundColor: greys(theme)[800],
        flexShrink: 1,
        flexGrow: 0,
        flexBasis: 'auto',
      }}
    />
  );
}

export default ({ context }: { context?: 'global' }) =>
  context
    ? registerSheet(sheetName, SheetWithRouter, context)
    : registerSheet(sheetName, SheetWithRouter);
