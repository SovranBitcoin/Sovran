import React from 'react';
import { Pressable, View, StyleSheet, Dimensions } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { useSelector } from 'react-redux';

import Icon from 'assets/icons';
import { useNostr } from 'redux/nostr';
import { memoizedGetSettings } from 'redux/settings';
import { useTheme } from 'providers/ThemeProvider';
import { popup } from '@/helper/popup';
import { memoizedGetSelectedMint } from 'redux/cashu';
import WalletHeader, { Background } from 'components/blocks/WalletHeader';
import { HStack, Spacer } from 'components/ui/View';
import { Avatar } from 'components/ui/Avatar';
import { SearchBar } from 'components/blocks/payments';
import { TAB_SCREENS } from '@/app/(drawer)/(tabs)/_layout.tabs';
import { useNavigation } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';

const Tab = createBottomTabNavigator();

const PROFILE_AVATAR_SIZE = 48;
const SPACING_XS = 8;
const SPACING_SM = 16;

const LIGHT_THEMES = ['light', 'beige'];

const isLightTheme = (themeName: string) => LIGHT_THEMES.includes(themeName);
const getBlurTint = (themeName: string) => (isLightTheme(themeName) ? 'light' : 'dark');
const getBlurIntensity = (themeName: string) => (isLightTheme(themeName) ? 7.5 : 75);

const TabBarBackground = () => {
  const { currentTheme } = useTheme();
  return (
    <BlurView
      tint={getBlurTint(currentTheme)}
      intensity={getBlurIntensity(currentTheme)}
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
};

const PaymentsHeaderTitle = () => {
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
      <SearchBar />
    </View>
  );
};

const WalletHeaderTitle = () => {
  const supportedUnits = ['sat', 'usd', 'eur', 'gbp'];
  const accounts = supportedUnits.map((unit) => ({ unit }));
  const [account, setAccount] = React.useState(accounts[0]);

  return <WalletHeader unit={account.unit} accounts={accounts} setAccount={setAccount} />;
};

const TabLayout = () => {
  const { getPrimaryColor, getShadeColor } = useTheme();
  const navigation = useNavigation();
  const { currentProfile } = useNostr();
  const settings = useSelector(memoizedGetSettings);
  const selectedMint = useSelector(memoizedGetSelectedMint);

  const isNavigationVisible = selectedMint && currentProfile?.pubkey && settings?.termsAccepted;

  const HeaderLeft = () => (
    <Pressable onPress={() => navigation.dispatch(DrawerActions.openDrawer())}>
      <HStack spacing={12} align="flex-start">
        <Spacer size={8} />
        <Avatar picture={currentProfile?.picture} />
      </HStack>
    </Pressable>
  );

  const HeaderRight = () => (
    <Pressable
      className="opacity-0"
      onPress={() => popup({ message: 'not_implemented', type: 'info' })}>
      <HStack spacing={8}>
        <View className="bg-primary-800 rounded-full p-2">
          <Icon name="solar:card-bold" color={getPrimaryColor('0')} />
        </View>
        <Spacer size={8} />
      </HStack>
    </Pressable>
  );

  // Function to get header title component based on screen
  const getHeaderTitle = (title: string) => {
    switch (title) {
      case 'Wallet':
        return WalletHeaderTitle;
      case 'Payments':
        return PaymentsHeaderTitle;
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
          tabBarBackground: () => <TabBarBackground />,
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
        {TAB_SCREENS.map(({ name, component, title, icon: IconComponent }) => (
          <Tab.Screen
            key={name}
            name={name}
            component={component}
            options={{
              headerTitle: getHeaderTitle(title),
              tabBarActiveTintColor: getShadeColor('300'),
              tabBarInactiveTintColor: getPrimaryColor('300'),
              tabBarLabel: '',
              tabBarIcon: ({ focused }) => <IconComponent focused={focused} />,
              headerLeft: HeaderLeft,
              headerRight: HeaderRight,
              headerStyle: {
                backgroundColor: getPrimaryColor('950'),
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
