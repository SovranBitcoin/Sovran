import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { useTheme } from 'providers/ThemeProvider';

function EmojiPickerSheet(props: any) {
  const { getPrimaryColor } = useTheme();

  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="emoji-grid"
      containerStyle={{ backgroundColor: getPrimaryColor('950') }}
      {...props}
    />
  );
}

export default ({ context }: { context?: 'global' }) =>
  context
    ? registerSheet(sheetName, EmojiPickerSheet, context)
    : registerSheet(sheetName, EmojiPickerSheet);
