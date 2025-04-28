import React from 'react';
import { View, Text } from 'react-native';
import { RouteScreenProps } from 'react-native-actions-sheet';

const MainRoute = ({ router }: RouteScreenProps<'credit-card-sheet', 'main'>) => {
  return (
    <View style={{ padding: 16 }}>
      <Text>Credit Card Main Route</Text>
    </View>
  );
};

export default MainRoute;
