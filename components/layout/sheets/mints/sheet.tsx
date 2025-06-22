import React from 'react';
import ActionSheet from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { Dimensions } from 'react-native';

export function Sheet({ initialRoute, routes, actionSheetRef }) {
  const theme = useSelector((state: any) => state.settings?.settings?.theme);

  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      ref={actionSheetRef}
      backgroundInteractionEnabled={false}
      gestureEnabled={true}
      containerStyle={{
        backgroundColor: greys(theme)[2300],
        height: Dimensions.get('window').height - 39,
      }}
      routes={routes}
      initialRoute={initialRoute}></ActionSheet>
  );
}
