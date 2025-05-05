import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';

function SheetWithRouter(props: any) {
  return (
    <ActionSheet
      testIDs={{
        modal: 'action_sheet_modal',
        backdrop: 'action_sheet_backdrop',
        sheet: 'action_sheet_container',
      }}
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="route-a"
      containerStyle={{ height: '90%' }}
    />
  );
}

export default ({ context }: { context: 'global' | 'modal' }) =>
  registerSheet(sheetName, SheetWithRouter, context);
