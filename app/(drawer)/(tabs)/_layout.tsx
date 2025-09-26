import React from 'react';
import { Pressable, View, StyleSheet, Dimensions } from 'react-native';
import {
  BottomTabNavigationOptions,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { useSelector } from 'react-redux';

import { useClientOnlyValue } from 'hooks/useClientOnlyValue';
import Icon, { SovranIcon, UserIcon } from 'assets/icons';
import CachedImage from 'components/common/Image';
import { greys, shades, Theme } from 'helper/colors';
import { useNostr } from 'helper/redux/nostr';
import { memoizedGetSettings, memoizedGetTheme } from 'helper/redux/settings';
import { TAB_SCREENS } from 'helper/navigation/screens';
import { SearchBar } from './payments';
import { showMessage } from 'helper/popup/popups';
import { memoizedGetSelectedMint } from 'helper/redux/cashu';
import { Background } from 'components/layout/WalletHeader';
import { useTypedNavigation } from 'helper/navigation';

const Tab = createBottomTabNavigator();

// Shared constants (used multiple times)
const PROFILE_AVATAR_SIZE = 48;
const CIRCULAR_BORDER_RADIUS = 1000;
const SPACING_XS = 8;
const SPACING_SM = 16;

const LIGHT_THEMES = ['light', 'beige'];

// Component for profile avatar
const ProfileAvatar = ({ picture }: { picture: string }) =>
  picture ? (
    <CachedImage
      source={{ uri: picture }}
      style={{
        width: PROFILE_AVATAR_SIZE,
        height: PROFILE_AVATAR_SIZE,
        borderRadius: CIRCULAR_BORDER_RADIUS,
      }}
    />
  ) : (
    <UserIcon />
  );

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

// Styles creator function
const createStyles = (theme: Theme) =>
  StyleSheet.create({
    tabBarStyle: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: 'transparent',
      borderTopColor: 'transparent',
      elevation: 0,
    },
    headerStyle: {
      backgroundColor: greys(theme)[950],
      height: 0,
    },
  });

// Main component
const TabLayout = () => {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();
  const { currentProfile } = useNostr();
  const settings = useSelector(memoizedGetSettings);
  const styles = createStyles(theme);
  const selectedMint = useSelector(memoizedGetSelectedMint);

  // Determine if navigation should be visible
  const isNavigationVisible = selectedMint && currentProfile?.pubkey && settings?.termsAccepted;
  // Component for header left (drawer opener)
  const HeaderLeft = () => (
    <Pressable onPress={() => navigation.openDrawer()}>
      <View className="ml-2">
        <ProfileAvatar picture={currentProfile?.picture} />
      </View>
    </Pressable>
  );

  const HeaderRight = () => (
    <Pressable className="opacity-0" onPress={() => showMessage('not_implemented')}>
      <View className="mr-2 rounded-full p-2" style={{ backgroundColor: greys(theme)[800] }}>
        <Icon name="solar:card-bold" color={greys(theme)[0]} />
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

  // Function to create tab screen options
  const createTabScreenOptions = (
    title: string,
    IconComponent: React.ComponentType<{ focused: boolean; theme: Theme }>
  ): BottomTabNavigationOptions => ({
    title,
    tabBarActiveTintColor: shades[300],
    tabBarInactiveTintColor: greys(theme)[300],
    headerTitleAlign: 'center',
    headerTintColor: '#fff',
    tabBarLabel: '',
    headerTitleStyle: { fontWeight: 'bold' },
    headerTitle: getHeaderTitle(title),
    headerStyle: styles.headerStyle,
    tabBarIcon: ({ focused }) => <IconComponent focused={focused} theme={theme} />,
    headerLeft: HeaderLeft,
    headerRight: HeaderRight,
  });

  return (
    <View className="flex-1">
      <Tab.Navigator
        initialRouteName="index"
        screenOptions={{
          headerShadowVisible: false,
          headerShown: Boolean(useClientOnlyValue(false, true) && isNavigationVisible),
          tabBarStyle: {
            ...styles.tabBarStyle,
            display: isNavigationVisible ? 'flex' : 'none',
          },
          headerBackground: () => <Background />,
          tabBarBackground: () => <TabBarBackground theme={theme} />,
          lazy: true,
        }}>
        {TAB_SCREENS().map(({ name, component, title, icon }) => (
          <Tab.Screen
            key={name}
            name={name}
            component={component}
            options={createTabScreenOptions(title, icon)}
          />
        ))}
      </Tab.Navigator>
    </View>
  );
};

export default TabLayout;
