import React from 'react';
import { View, Text, Button } from 'react-native';
import { RouteScreenProps } from 'react-native-actions-sheet';

const AddCardRoute = ({ router }: RouteScreenProps<'credit-card-sheet', 'add-card'>) => {
  return (
    <View style={{ padding: 16 }}>
      <Text>Add Credit Card Route</Text>
      {router && (
        <Button
          title="Go Back"
          onPress={() => {
            router.goBack();
          }}
        />
      )}
    </View>
  );
};

export default AddCardRoute;
