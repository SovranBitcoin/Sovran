import React from "react";
import { View, Button } from "react-native";
import {
  useSheetRouter,
  useSheetRouteParams,
} from "react-native-actions-sheet";

const RouteB = () => {
  const router = useSheetRouter("example-sheet-with-router");
  const params = useSheetRouteParams("example-sheet-with-router", "route-b");
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
