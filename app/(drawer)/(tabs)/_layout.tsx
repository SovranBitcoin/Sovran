import React, { useState, useEffect, useRef } from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { useSettingsStore } from 'stores/settingsStore';
import { useTheme } from 'providers/ThemeProvider';
import { popup } from '@/helper/popup';
import WalletHeader, { Background } from 'components/blocks/WalletHeader';
import { HStack } from 'components/ui/View';
import { Avatar } from 'components/ui/Avatar';
import { TAB_SCREENS } from '@/app/(drawer)/(tabs)/_layout.tabs';
import { useNavigation, usePathname } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { EnhancedHaptics } from 'components/ui/Haptics';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useSend, useReceive } from 'hooks/coco';
import { useMintStore } from 'stores/mintStore';
import { handlePOSPaymentTest } from '@/helper/nfcPosPayment';
import { Button } from '@/components/ui/Button';
import Icon from '@/assets/icons';
// import { Button, Host } from '@expo/ui/swift-ui';
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
  const hasNavigatedToIndex = useRef(false);

  const isNavigationVisible = nostrKeys?.pubkey && isTermsAccepted;
  const isPaymentsTab = pathname?.includes('/payments');

  // Ensure wallet tab is selected on initial mount
  useEffect(() => {
    if (!hasNavigatedToIndex.current && isNavigationVisible) {
      hasNavigatedToIndex.current = true;
      // Only navigate if we're on the payments route on initial load
      if (pathname?.includes('/payments')) {
        // Use setTimeout to ensure navigation happens after tab navigator is ready
        setTimeout(() => {
          navigation.navigate('index' as never);
        }, 100);
      }
    }
  }, [isNavigationVisible, pathname, navigation]);

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

  const HeaderRight = () => {
    const { send } = useSend();
    const { receive } = useReceive();
    const { keys: nostrKeys } = useNostrKeysContext();
    const selectedMints = useMintStore((state) => state.selectedMints);
    const selectedMint = nostrKeys?.pubkey ? selectedMints[nostrKeys.pubkey] : undefined;
    const [isProcessing, setIsProcessing] = useState(false);

    const handleNFCPress = async () => {
      if (isProcessing) return;

      await EnhancedHaptics.navigateHaptic();

      if (!nostrKeys?.pubkey) {
        popup({
          message: 'Please set up your wallet first',
          emoji: '🚨',
          type: 'error',
        });
        return;
      }

      if (!selectedMint) {
        popup({
          message: 'Please select a mint first',
          emoji: '🚨',
          type: 'error',
        });
        return;
      }

      setIsProcessing(true);

      try {
        await handlePOSPaymentTest(send, receive);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        popup({
          message: `NFC payment failed: ${errorMessage}`,
          emoji: '🚨',
          type: 'error',
        });
      } finally {
        setIsProcessing(false);
      }
    };

    // Only show button if user is authenticated and has a selected mint
    if (!nostrKeys?.pubkey || !selectedMint) {
      return null;
    }

    return (
      <Button
        blur
        style={{ width: 48, height: 48, marginRight: 12, marginTop: 58 }}
        icon={<Icon name="lucide:nfc" size={20} />}
        onPress={handleNFCPress}
        variant="secondary"
      />
    );
    // return (
    //   <Host modifiers={[frame({ width: 100, height: 100, alignment: 'bottomTrailing' })]}>
    //     <Button
    //       variant="plain"
    //       systemImage="antenna.radiowaves.left.and.right"
    //       onPress={handleNFCPress}
    //       modifiers={[
    //         frame({ width: 64, height: 64, alignment: 'bottomTrailing' }),
    //         // padding({ all: 16 }),
    //         glassEffect({
    //           shape: 'circle',
    //         }),
    //       ]}
    //     />
    //   </Host>
    // );
  };

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
              headerRight: name === 'index' ? HeaderRight : undefined,
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
