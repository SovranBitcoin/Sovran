import React from 'react';
import { Pressable, View, StyleSheet, Dimensions } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { useSelector } from 'react-redux';

import { SovranIcon } from 'assets/icons';
import { greys, shades, Theme } from 'helper/colors';
import { useNostr } from 'helper/redux/nostr';
import { memoizedGetSettings, memoizedGetTheme } from 'helper/redux/settings';
import { TAB_SCREENS } from 'helper/navigation/screens';
import { SearchBar } from './payments';
import { memoizedGetSelectedMint } from 'helper/redux/cashu';
import { Background } from 'components/layout/WalletHeader';
import { useTypedNavigation } from 'helper/navigation';
import { Avatar } from 'components/common/Avatar';

const Tab = createBottomTabNavigator();

const PROFILE_AVATAR_SIZE = 48;
const SPACING_XS = 8;
const SPACING_SM = 16;

const LIGHT_THEMES = ['light', 'beige'];

// Helper functions for theme-related logic
const isLightTheme = (theme: Theme) => LIGHT_THEMES.includes(theme.id);
const getBlurTint = (theme: Theme) => (isLightTheme(theme) ? 'light' : 'dark');
const getBlurIntensity = (theme: Theme) => (isLightTheme(theme) ? 7.5 : 75);

const TabBarBackground = ({ theme }: { theme: Theme }) => (
  <BlurView
    tint={getBlurTint(theme)}
    intensity={getBlurIntensity(theme)}
    className="overflow-hidden opacity-100"
    style={[
      StyleSheet.absoluteFill,
      {
        borderRadius: SPACING_XS,
        top: -0.5,
      },
    ]}
  />
);

// Header title components
const WalletHeaderTitle = () => <SovranIcon />;

const PaymentsHeaderTitle = ({ navigation, theme }: { navigation: any; theme: Theme }) => {
  const screenWidth = Dimensions.get('window').width;
  const searchContainerWidth = screenWidth - PROFILE_AVATAR_SIZE + SPACING_SM;
  const marginOffset = -(PROFILE_AVATAR_SIZE + SPACING_XS);

  return (
    <View
      className="justify-center pr-4"
      style={{
        width: searchContainerWidth,
        marginLeft: marginOffset,
        marginTop: -SPACING_XS,
      }}>
      <SearchBar navigation={navigation} theme={theme} />
    </View>
  );
};

// Main component
const TabLayout = () => {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();
  const { currentProfile } = useNostr();
  const settings = useSelector(memoizedGetSettings);
  const selectedMint = useSelector(memoizedGetSelectedMint);

  // Determine if navigation should be visible
  const isNavigationVisible = selectedMint && currentProfile?.pubkey && settings?.termsAccepted;
  // Component for header left (drawer opener)
  const HeaderLeft = () => (
    <Pressable onPress={() => navigation.openDrawer()}>
      <View className="ml-2">
        <Avatar picture={currentProfile?.picture} />
      </View>
    </Pressable>
  );

  // Function to get header title component based on screen
  const getHeaderTitle = (title: string) => {
    switch (title) {
      case 'Wallet':
        return WalletHeaderTitle;
      case 'Payments':
        return function PaymentsHeaderTitleWrapper() {
          return <PaymentsHeaderTitle navigation={navigation} theme={theme} />;
        };
      default:
        return undefined;
    }
  };

  return (
    <View className="flex-1">
      <Tab.Navigator
        initialRouteName="index"
        screenOptions={{
          lazy: true,
          headerBackground: () => <Background />,
          tabBarBackground: () => <TabBarBackground theme={theme} />,
          tabBarStyle: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: 'transparent',
            borderTopColor: 'transparent',
            elevation: 0,
            display: isNavigationVisible ? 'flex' : 'none',
          },
        }}>
        {TAB_SCREENS().map(({ name, component, icon: IconComponent }) => (
          <Tab.Screen
            key={name}
            name={name}
            component={component}
            options={{
              tabBarActiveTintColor: shades[300],
              tabBarInactiveTintColor: greys(theme)[300],
              tabBarLabel: '',
              tabBarIcon: ({ focused }) => <IconComponent focused={focused} theme={theme} />,
              headerLeft: HeaderLeft,
              headerStyle: {
                backgroundColor: greys(theme)[950],
                height: 0,
              },
            }}
          />
        ))}
      </Tab.Navigator>
    </View>
  );
};

export default TabLayout;
