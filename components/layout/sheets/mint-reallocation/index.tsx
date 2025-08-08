import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { Dimensions } from 'react-native';
import { greys } from 'helper/colors';

function MintReallocationSheet(props: any) {
  const theme = useSelector(memoizedGetTheme);
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      containerStyle={{
        backgroundColor: greys(theme)[950],
        height: Dimensions.get('screen').height - 32,
      }}
      gestureEnabled={false}
      {...props}
    />
  );
}

export default ({ context }: { context?: 'global' }) =>
  context
    ? registerSheet(sheetName, MintReallocationSheet, context)
    : registerSheet(sheetName, MintReallocationSheet);
