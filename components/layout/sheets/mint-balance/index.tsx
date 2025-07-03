import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { Dimensions } from 'react-native';

function MintBalanceSheet({ context, ...props }: { context: 'global' | 'modal' }) {
  const theme = useSelector(memoizedGetTheme);
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="list"
      containerStyle={{
        backgroundColor: greys(theme)[950],
        height: context === 'modal' ? '90%' : Dimensions.get('window').height - 39,
      }}
      gestureEnabled={true}
      {...props}
    />
  );
}

export default ({ context }: { context: 'global' | 'modal' }) =>
  registerSheet(sheetName, (props: any) => <MintBalanceSheet context={context} {...props} />, context);
