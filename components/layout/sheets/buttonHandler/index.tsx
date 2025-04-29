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
      closeAnimationConfig={{
        damping: 50,
        mass: 0.5,
        stiffness: 200,
        overshootClamping: false,
        restDisplacementThreshold: 0.01,
        restSpeedThreshold: 0.01,
      }}
      openAnimationConfig={{
        damping: 50,
        mass: 0.5,
        stiffness: 200,
        overshootClamping: false,
        restDisplacementThreshold: 0.01,
        restSpeedThreshold: 0.01,
      }}
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
