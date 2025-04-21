import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';

function SheetWithRouter(props: any) {
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="route-a"
      containerStyle={{
        backgroundColor: 'transparent',
        flexShrink: 1,
        flexGrow: 0,
        flexBasis: 'auto',
      }}
    />
  );
}

registerSheet(sheetName, SheetWithRouter);
