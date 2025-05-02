import React from 'react';
import { Dimensions } from 'react-native';
import { Drawer } from 'expo-router/drawer';
import ProfileComponent from '../Profile';
import { useNostr } from 'helper/redux/nostr';

const screenWidth = Dimensions.get('screen').width;

export default function DrawerLayout() {
  const { currentProfile } = useNostr();
  return (
    <Drawer
      screenOptions={{
        swipeEnabled: currentProfile?.pubkey ? true : false,
        headerShown: false,
        drawerType: 'slide',
        swipeEdgeWidth: screenWidth * 0.15,
        swipeMinDistance: 25,
        drawerPosition: 'left',
        drawerStyle: {
          backgroundColor: 'transparent',
          width: currentProfile?.pubkey ? Math.max(screenWidth - 50, screenWidth * 0.9) : 0,
          paddingRight: 0,
        },
        keyboardDismissMode: 'none',
        drawerContentContainerStyle: {
          flexGrow: 1,
        },
      }}
      drawerContent={() => {
        if (!currentProfile?.pubkey) return <></>;
        return <ProfileComponent />;
      }}>
      <Drawer.Screen name="(tabs)" options={{ headerShown: false }} />
    </Drawer>
  );
}
