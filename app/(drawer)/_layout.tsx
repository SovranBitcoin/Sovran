import React from "react";
import { Dimensions } from "react-native";
import { Drawer } from "expo-router/drawer";
import ProfileComponent from "../Profile";

const screenWidth = Dimensions.get("screen").width;

export default function DrawerLayout() {
  return (
    <Drawer
      screenOptions={{
        swipeEnabled: true,
        headerShown: false,
        drawerType: "slide",
        swipeEdgeWidth: screenWidth * 0.15,
        swipeMinDistance: 25,
        drawerPosition: "left",
        drawerStyle: {
          backgroundColor: "transparent",
          width: Math.max(screenWidth - 50, screenWidth * 0.9),
          paddingRight: 0,
        },
        keyboardDismissMode: "none",
        drawerContentContainerStyle: {
          flexGrow: 1,
        },
      }}
      drawerContent={() => {
        return <ProfileComponent />;
      }}
    >
      <Drawer.Screen name="(tabs)" options={{ headerShown: false }} />
    </Drawer>
  );
}
