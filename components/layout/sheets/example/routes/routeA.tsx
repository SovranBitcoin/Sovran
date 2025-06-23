import React from 'react';
import { View, Button } from 'react-native';
import { RouteScreenProps, useSheetRef } from 'react-native-actions-sheet';

const RouteA = ({ router }: RouteScreenProps<'example-sheet-with-router', 'route-a'>) => {
  // when data is passed from .show() method, it will be available in the payload
  const ref = useSheetRef('mint-adder');

  return (
    <View>
      <Button
        testID="route-b-button"
        title="Go to Route B"
        onPress={() => {
          router.navigate('route-b', { data: 'test' });
        }}
      />
      <Button
        title="Return data"
        onPress={() => {
          ref.current.hide({
            // Respond with data here that is needed in the SheetManager.show() method
          });
        }}
      />
    </View>
  );
};

export default RouteA;
