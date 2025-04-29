import React from 'react';
import { View, Text } from 'react-native';
import { RouteScreenProps } from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';

const MainRoute = ({ router }: RouteScreenProps<'credit-card-sheet', 'main'>) => {
  const theme = useSelector(memoizedGetTheme);
  return (
    <View
      style={{
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: greys(theme)[2300],
      }}></View>
  );
};

export default MainRoute;
