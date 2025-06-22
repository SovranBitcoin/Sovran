import React from 'react';
import { View, Button } from 'react-native';
import { useSheetRouter } from 'react-native-actions-sheet';

const RouteB = () => {
  const router = useSheetRouter('npubcash-selector-sheet');

  if (!router) {
    return null; // Handle the case where router is undefined
  }

  return (
    <View>
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
