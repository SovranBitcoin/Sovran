import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';

function TransactionMessageSheet(props: any) {
  const theme = useSelector(memoizedGetTheme);
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      gestureEnabled={true}
      routes={routes}
      initialRoute="message-input"
      containerStyle={{
        backgroundColor: greys(theme)[1800],
        flexShrink: 1,
        flexGrow: 0,
        flexBasis: 'auto',
      }}
      {...props}
    />
  );
}

export default ({ context }: { context: 'global' | 'modal' }) =>
  registerSheet(sheetName, TransactionMessageSheet, context);
