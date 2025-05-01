import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';

function SheetWithRouter(props: any) {
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="route-a"
      containerStyle={{ height: '90%' }}
    />
  );
}

export default ({ context }: { context: 'global' | 'modal' }) =>
  registerSheet(sheetName, SheetWithRouter, context);
