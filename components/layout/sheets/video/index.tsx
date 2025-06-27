import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';

function SheetWithRouter() {
  const theme = useSelector(memoizedGetTheme);
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="route-a"
      containerStyle={{
        height: '90%',
        backgroundColor: theme.greys[2300],
        justifyContent: 'center',
        alignItems: 'center',
      }}
      gestureEnabled={true}
    />
  );
}

export default ({ context }: { context: 'global' | 'modal' }) =>
  registerSheet(sheetName, SheetWithRouter, context);
