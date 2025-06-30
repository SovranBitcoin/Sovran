import React from 'react';
import ActionSheet from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { Dimensions } from 'react-native';
import { memoizedGetTheme } from 'helper/redux/settings';

export function Sheet({ initialRoute, routes, actionSheetRef }) {
  const theme = useSelector(memoizedGetTheme);

  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      ref={actionSheetRef}
      backgroundInteractionEnabled={false}
      gestureEnabled={true}
      containerStyle={{
        backgroundColor: greys(theme)[950],
        height: Dimensions.get('window').height - 39,
      }}
      routes={routes}
      initialRoute={initialRoute}></ActionSheet>
  );
}
