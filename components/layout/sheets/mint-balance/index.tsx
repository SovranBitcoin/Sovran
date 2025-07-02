import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';

function MintBalanceSheet(props: any) {
  const theme = useSelector(memoizedGetTheme);
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="list"
      containerStyle={{ backgroundColor: greys(theme)[950], height: '90%' }}
      gestureEnabled={true}
      {...props}
    />
  );
}

export default ({ context }: { context: 'global' | 'modal' }) =>
  registerSheet(sheetName, MintBalanceSheet, context);
