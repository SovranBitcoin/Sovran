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
      testIDs={{
        modal: 'mint-adder-modal',
        backdrop: 'mint-adder-backdrop',
        sheet: 'mint-adder-sheet',
      }}
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="route-a"
      containerStyle={{ height: '90%', backgroundColor: greys(theme)[2300] }}
      gestureEnabled={true}
    />
  );
}

export default ({ context }: { context: 'global' | 'modal' }) =>
  registerSheet(sheetName, SheetWithRouter, context);
