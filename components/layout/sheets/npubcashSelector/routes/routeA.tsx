import { Picker } from "@react-native-picker/picker";
import React, { useState } from "react";
import { View } from "react-native";
import { RouteScreenProps } from "react-native-actions-sheet";

const RouteA = ({
  router,
}: RouteScreenProps<"example-sheet-with-router", "route-a">) => {
  const [selectedValue, setSelectedValue] = useState("option1");
  return (
    <View>
      <Picker
        selectedValue={selectedValue}
        onValueChange={(itemValue) => setSelectedValue(itemValue)}
        style={{
          height: 200,
          width: 300,
          backgroundColor: "#f0f0f0",
          borderRadius: 10,
        }}
        itemStyle={{
          color: "#333",
          fontFamily: "Ebrima",
          fontSize: 18,
        }}
      >
        <Picker.Item label="sovran.id" value="sovran.id" />
        <Picker.Item label="npub.cash" value="npub.cash" />
      </Picker>
    </View>
  );
};

export default RouteA;
