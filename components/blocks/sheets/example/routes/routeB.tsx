import { Text } from 'components/ui/Text';
import React from 'react';
import { View, Button } from 'react-native';
import { RouteScreenProps, useSheetRouteParams } from 'react-native-actions-sheet';

const RouteB = ({ router }: RouteScreenProps<'example-sheet-with-router', 'route-b'>) => {
  const params = useSheetRouteParams('example-sheet-with-router', 'route-b');
  // get params from the route

  if (!router) {
    return null; // Handle the case where router is undefined
  }

  return (
    <View>
      <Text>{JSON.stringify(params)}</Text>
      <Button
        title="Go Back to Route A"
        onPress={() => {
          router.goBack();
        }}
      />
    </View>
  );
};

export default RouteB;
