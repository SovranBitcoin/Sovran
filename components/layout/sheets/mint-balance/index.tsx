import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Dimensions } from 'react-native';
import { greys } from 'helper/colors';

function MintBalanceSheet(props: any) {
  const theme = useSelector(memoizedGetTheme);
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="list"
      containerStyle={{
        backgroundColor: greys(theme)[950],
        height: Dimensions.get('screen').height - 32,
      }}
      safeAreaInsets={{ ...useSafeAreaInsets(), bottom: 0, top: 0 }}
      gestureEnabled={true}
      {...props}
    />
  );
}

export default ({ context }: { context?: 'global' }) =>
  context
    ? registerSheet(sheetName, MintBalanceSheet, context)
    : registerSheet(sheetName, MintBalanceSheet);
