import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sheetName, routes } from './routes';
import { useTheme } from 'providers/ThemeProvider';

function MerchantDetailSheet(props: any) {
  const { getPrimaryColor } = useTheme();

  return (
    <ActionSheet
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="detail"
      containerStyle={{
        backgroundColor: getPrimaryColor('900'),
        height: Dimensions.get('screen').height * 0.8,
      }}
      safeAreaInsets={{ ...useSafeAreaInsets(), bottom: 0, top: 0 }}
      gestureEnabled={true}
      {...props}
    />
  );
}

export default ({ context }: { context?: 'global' }) =>
  context
    ? registerSheet(sheetName, MerchantDetailSheet, context)
    : registerSheet(sheetName, MerchantDetailSheet);

