import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import Icon from 'assets/icons';
import { useSettingsStore } from 'stores/settingsStore';
import { useTheme } from 'providers/ThemeProvider';
import { popup } from '@/helper/popup';
import WalletHeader, { Background } from 'components/blocks/WalletHeader';
import { HStack, Spacer } from 'components/ui/View';
import { Avatar } from 'components/ui/Avatar';
import { TAB_SCREENS } from '@/app/(drawer)/(tabs)/_layout.tabs';
import { useNavigation, usePathname } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { EnhancedHaptics } from 'components/ui/Haptics';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';

const Tab = createBottomTabNavigator();

const SPACING_XS = 8;

const LIGHT_THEMES = ['light', 'beige'];

const isLightTheme = (themeName: string) => LIGHT_THEMES.includes(themeName);
const getBlurTint = (themeName: string) => (isLightTheme(themeName) ? 'light' : 'dark');
const getBlurIntensity = (themeName: string) => (isLightTheme(themeName) ? 7.5 : 75);

// Wrapper component for tab icons with haptic feedback
const TabIconWithHaptics = ({
  IconComponent,
  focused,
  onPress,
}: {
  IconComponent: React.ComponentType<{ focused: boolean }>;
  focused: boolean;
  onPress: () => void;
}) => {
  const handlePress = async () => {
    await EnhancedHaptics.navigateHaptic();
    onPress();
  };

  return (
    <Pressable onPress={handlePress}>
      <IconComponent focused={focused} />
    </Pressable>
  );
};

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

const WalletHeaderTitle = () => {
  const { keys: nostrKeys } = useNostrKeysContext();
  const supportedUnits = ['sat', 'usd', 'eur', 'gbp'];
  const accounts = supportedUnits.map((unit) => ({ unit }));
  const [account, setAccount] = React.useState(accounts[0]);

  // Always render the component but conditionally show content
  if (!nostrKeys?.pubkey) {
    return null;
  }

  return <WalletHeader unit={account.unit} accounts={accounts} setAccount={setAccount} />;
};

const TabLayout = () => {
  const { getPrimaryColor, getShadeColor } = useTheme();
  const navigation = useNavigation();
  const pathname = usePathname();
  const { keys: nostrKeys } = useNostrKeysContext();
  const isTermsAccepted = useSettingsStore((state) => state.isTermsAccepted());

  const isNavigationVisible = nostrKeys?.pubkey && isTermsAccepted;
  const isPaymentsTab = pathname?.includes('/payments');

  const HeaderLeft = () => {
    if (!nostrKeys?.pubkey || isPaymentsTab) return null;

    const handleAvatarPress = async () => {
      await EnhancedHaptics.navigateHaptic();
      navigation.dispatch(DrawerActions.openDrawer());
    };

    return (
      <Pressable onPress={handleAvatarPress}>
        <HStack spacing={12} align="flex-start" className="ml-4">
          <Avatar seed={nostrKeys?.pubkey} size={48} variant="person" />
        </HStack>
      </Pressable>
    );
  };

  const HeaderRight = () => (
    <Pressable
      className="opacity-0"
      onPress={() => popup({ message: 'not_implemented', type: 'info' })}>
      <HStack spacing={8}>
        <View className="rounded-full bg-primary-800 p-2">
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
            options={({ navigation }) => ({
              headerTitle: getHeaderTitle(title),
              tabBarActiveTintColor: getShadeColor('300'),
              tabBarInactiveTintColor: getPrimaryColor('300'),
              tabBarLabel: '',
              tabBarIcon: ({ focused }) => (
                <TabIconWithHaptics
                  IconComponent={IconComponent}
                  focused={focused}
                  onPress={() => navigation.navigate(name as any)}
                />
              ),
              headerLeft: HeaderLeft,
              headerRight: HeaderRight,
              headerStyle: {
                backgroundColor: getPrimaryColor('950'),
                height: 0,
              },
            })}
          />
        ))}
      </Tab.Navigator>
    </View>
  );
};

export default TabLayout;
