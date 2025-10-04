import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { greys } from '@/helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from '@/helper/redux/settings';

function SheetWithRouter() {
  const theme = useSelector(memoizedGetTheme);
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="route-a"
      containerStyle={{
        flexShrink: 1,
        flexGrow: 0,
        flexBasis: 'auto',
        backgroundColor: greys(theme)[800],
      }}
    />
  );
}

export default ({ context }: { context?: 'global' }) =>
  context
    ? registerSheet(sheetName, SheetWithRouter, context)
    : registerSheet(sheetName, SheetWithRouter);
