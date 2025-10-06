import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { useTheme } from 'providers/ThemeProvider';

function TransactionMessageSheet(props: any) {
  const { getPrimaryColor } = useTheme();
  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      gestureEnabled={true}
      routes={routes}
      initialRoute="message-input"
      containerStyle={{
        backgroundColor: getPrimaryColor('800'),
        flexShrink: 1,
        flexGrow: 0,
        flexBasis: 'auto',
      }}
      {...props}
    />
  );
}

export default ({ context }: { context?: 'global' }) =>
  context
    ? registerSheet(sheetName, TransactionMessageSheet, context)
    : registerSheet(sheetName, TransactionMessageSheet);
