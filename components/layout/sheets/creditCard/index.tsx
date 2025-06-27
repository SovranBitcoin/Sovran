import React from 'react';
import ActionSheet, { registerSheet } from 'react-native-actions-sheet';
import { sheetName, routes } from './routes';
import { Dimensions } from 'react-native';
import { CARD_HEIGHT } from 'components/common/NFCCard';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';

const height = Dimensions.get('window').height;

function CreditCardSheet(props: any) {
  const theme = useSelector(memoizedGetTheme);
  return (
    <ActionSheet
      // onChange={(position, height) => {
      //   console.log(position, height);
      // }}
      backgroundInteractionEnabled
      enableRouterBackNavigation={true}
      routes={routes}
      initialRoute="main"
      containerStyle={{
        height: height - CARD_HEIGHT - 64 - 8,
        backgroundColor: theme.greys[2300],
      }}
      gestureEnabled={true}
      {...props}
    />
  );
}

// Register the sheet with its unique name
export default ({ context }: { context: 'global' | 'modal' }) =>
  registerSheet(sheetName, CreditCardSheet, context);
