import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';

function SheetWithRouter(props: any) {
  const theme = useSelector(memoizedGetTheme);

  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="route-a"
      containerStyle={{
        backgroundColor: greys(theme)[1800],
        flexShrink: 1,
        flexGrow: 0,
        flexBasis: 'auto',
      }}
      gestureEnabled={true}
    />
  );
}

registerSheet(sheetName, SheetWithRouter);
