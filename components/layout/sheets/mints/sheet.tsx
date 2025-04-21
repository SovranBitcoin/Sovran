import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';

export function Sheet({ initialRoute, routes, actionSheetRef }) {
  const theme = useSelector((state: any) => state.settings?.settings?.theme);

  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      ref={actionSheetRef}
      backgroundInteractionEnabled={false}
      gestureEnabled={true}
      containerStyle={{ backgroundColor: greys(theme)[2300], height: '90%' }}
      routes={routes}
      initialRoute={initialRoute}></ActionSheet>
  );
}
