import React from 'react';
import { View, Button } from 'react-native';
import { RouteScreenProps } from 'react-native-actions-sheet';

const RouteA = ({ router }: RouteScreenProps<'example-sheet-with-router', 'route-a'>) => {
  return (
    <View>
      <Button
        title="Go to Route B"
        onPress={() => {
          router.navigate('route-b', { data: 'test' });
        }}
      />
    </View>
  );
};

export default RouteA;
