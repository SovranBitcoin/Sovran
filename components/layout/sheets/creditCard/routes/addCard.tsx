import React from 'react';
import { View, Button } from 'react-native';
import { RouteScreenProps } from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';

const AddCardRoute = ({ router }: RouteScreenProps<'credit-card-sheet', 'add-card'>) => {
  const theme = useSelector(memoizedGetTheme);
  return (
    <View style={{ padding: 16, backgroundColor: greys(theme)[2300] }}>
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
