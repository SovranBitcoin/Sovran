import { useState } from 'react';
import { Drawer } from 'expo-router/drawer';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { getScreenCornerRadius } from '@/shared/lib/screenCornerRadius';
import { isNestedStackAtRoot } from '@/navigation/drawerGesture';
import { DrawerContent } from '@/navigation/DrawerContent';
import { computeDrawerWidth } from '@/navigation/DrawerSceneOverlay';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { radius } from '@/shared/styles/tokens';

export default function DrawerLayout() {
  const [nestedPushed, setNestedPushed] = useState(false);
  const { width } = useWindowDimensions();
  const surface = useThemeColor('surface');
  // Match the device's hardware screen corner radius so the scene's rounded
  // TL/BL hug the physical display curve. Falls back to a token-driven radius
  // when null (Android <12, or devices without rounded displays).
  const deviceRadius = getScreenCornerRadius(radius['2xl']);
  const drawerWidth = computeDrawerWidth(width, deviceRadius);
  return (
    <GestureHandlerRootView style={[styles.container, { backgroundColor: surface }]}>
      <Drawer
        screenListeners={{
          state: ({ data: { state } }) => {
            // Screen-option routes omit child state in Expo Router's fork;
            // the state event includes it for both JS and native tabs.
            const route = state.routes[state.index];
            setNestedPushed(route ? !isNestedStackAtRoot(route) : false);
          },
        }}
        screenOptions={{
          headerShown: false,
          drawerType: 'slide',
          drawerStyle: {
            width: drawerWidth,
            backgroundColor: 'transparent',
            overflow: 'hidden',
          },
          sceneStyle: {
            borderTopLeftRadius: deviceRadius,
            borderBottomLeftRadius: deviceRadius,
            borderCurve: 'continuous',
            overflow: 'hidden',
          },
          // Stock overlay stays transparent for tap-to-close; `DrawerSceneOverlay`
          // draws the rounded dim + hairline inside the clipped scene so square
          // overlay corners never cover the continuous curve.
          overlayColor: 'transparent',
          // A narrow edge, so swipes across the wallet's account carousel stay with it.
          swipeEdgeWidth: 32,
          swipeMinDistance: 10,
        }}
        drawerContent={(props) => <DrawerContent {...props} />}>
        <Drawer.Screen
          name="(tabs)"
          options={{
            drawerLabel: 'Wallet',
            title: 'Wallet',
            swipeEnabled: !nestedPushed,
          }}
        />
      </Drawer>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
