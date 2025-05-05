import { Pressable, View, StyleSheet, Platform, Dimensions } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { useSelector } from 'react-redux';

import { useClientOnlyValue } from 'components/useClientOnlyValue';
import Icon, { SovranIcon, UserIcon } from 'assets/icons';
import CachedImage from 'components/common/Image';
import { translateText } from 'components/common/Themed';
import { greys, shades } from 'helper/colors';
import { useNostr } from 'helper/redux/nostr';
import { memoizedGetTheme } from 'helper/redux/settings';
import { TAB_SCREENS } from 'helper/navigation/screens';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SearchBar } from './payments';
import { showMessage } from 'helper/popup/popups';
import { memoizedGetSelectedMint } from 'helper/redux/cashu';

const Stack = createNativeStackNavigator();

// Types
type ThemeType = string;
type DrawerNavigation = { openDrawer: () => void };

const Tab = createBottomTabNavigator();

// Component for profile avatar
const ProfileAvatar = ({ picture }) =>
  picture ? (
    <CachedImage source={{ uri: picture }} style={{ width: 38, height: 38, borderRadius: 1000 }} />
  ) : (
    <UserIcon />
  );

// Tab bar components
const TabBarIcon = ({ title, IconComponent, focused, theme }) => {
  if (title === 'Wallet') {
    return (
      <>
        <View
          style={{
            position: 'absolute',
            overflow: 'hidden',
            height: 20,
            width: 100,
            bottom: 33,
          }}>
          <BlurView
            tint={['light', 'beige'].includes(theme) ? 'light' : 'dark'}
            intensity={Platform.OS === 'ios' ? 50 : 7.5}
            experimentalBlurMethod="dimezisBlurView"
            style={[
              {
                width: '100%',
                height: '100%',

                // backgroundColor: "red",
                borderRadius: 10000,
                overflow: 'hidden',
                position: 'absolute',
                top: 8,
                left: 18,
                zIndex: 1000,
                width: 64,
                height: 64,
                // backgroundColor: "red",
                backgroundColor: opacity(greys(theme)[2100], 0.5),

                zIndex: -2,
              },
            ]}></BlurView>
        </View>

        <LinearGradient
          colors={[greys(theme)[focused ? 0 : 1300], greys(theme)[focused ? 100 : 1500]]}
          style={{
            padding: 16,
            borderRadius: 1000,
          }}>
          <IconComponent color={focused ? 'black' : 'white'} />
        </LinearGradient>
      </>
    );
  }

  return <IconComponent color={focused ? shades[300] : greys(theme)[1000]} />;
};

const TabBarBackground = ({ theme }) => (
  <>
    <BlurView
      tint={['light', 'beige'].includes(theme) ? 'light' : 'dark'}
      intensity={Platform.OS === 'ios' ? 75 : 7.5}
      experimentalBlurMethod="dimezisBlurView"
      style={[
        StyleSheet.absoluteFill,
        {
          overflow: 'hidden',
          borderRadius: 8,
          top: -0.5,
          opacity: 1,
        },
      ]}
    />
    {/* <View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: opacity(greys(theme)[2100], 0.5),
          overflow: "hidden",
          borderRadius: 8,

          // borderWidth: 3,
          // borderColor: greys(theme)[2300],
        },
      ]}
    /> */}
  </>
);

// Styles creator function
const createStyles = (theme) =>
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
      backgroundColor: greys(theme)[2300],
    },
    headerLeftContainer: {
      marginLeft: 8,
    },
    headerRightContainer: {
      marginRight: 8,
      padding: 8,
      borderRadius: 1000,
      backgroundColor: greys(theme)[1800],
    },
    searchContainer: {
      justifyContent: 'center',
      width: Dimensions.get('window').width - 48 + 16, // Adjusting for profile icon width (38) + margins (8)
      marginLeft: -48 - 8,
      marginTop: -8,
    },
    searchBar: {
      width: '100%', // Full width of the search container
    },
  });

// Main component
const TabLayout = () => {
  const theme = useSelector(memoizedGetTheme);
  const language = useSelector((state) => state.settings?.settings?.lang);
  const navigation = useNavigation();
  const { currentProfile } = useNostr();
  const settings = useSelector((state) => state.settings.settings);
  const styles = createStyles(theme);
  const selectedMint = useSelector(memoizedGetSelectedMint);

  // Determine if navigation should be visible
  const isNavigationVisible = selectedMint && currentProfile?.pubkey && settings?.termsAccepted;

  // Component for header left (drawer opener)
  const HeaderLeft = () => (
    <Pressable onPress={() => navigation.openDrawer()}>
      <View style={styles.headerLeftContainer}>
        <ProfileAvatar picture={currentProfile?.picture} />
      </View>
    </Pressable>
  );

  const HeaderRight = () => (
    <Pressable style={{ opacity: 0 }} onPress={() => showMessage('not_implemented')}>
      <View style={styles.headerRightContainer}>
        <Icon name="solar:card-bold" color={greys(theme)[0]} />
        {/* <ProfileAvatar picture={currentProfile?.picture} /> */}
      </View>
    </Pressable>
  );

  // Function to create tab screen options
  const createTabScreenOptions = (title, IconComponent) => ({
    title: translateText({ id: null, children: title, lang: language }),
    tabBarActiveTintColor: shades[500],
    tabBarInactiveTintColor: greys(theme)[600],
    headerTitleAlign: 'center',
    headerTintColor: '#fff',
    tabBarLabel: '',
    headerTitleStyle: { fontWeight: 'bold' },
    headerTitle:
      title === 'Wallet'
        ? () => <SovranIcon />
        : title === 'Payments'
          ? () => (
              <View
                style={[
                  styles.searchContainer,
                  {
                    paddingRight: 48 + 4,
                  },
                ]}>
                <SearchBar navigation={navigation} theme={theme} style={styles.searchBar} />
              </View>
            )
          : undefined,
    headerStyle: styles.headerStyle,
    headerLargeTitle: true,
    tabBarIcon: ({ focused }) => (
      <TabBarIcon title={title} IconComponent={IconComponent} focused={focused} theme={theme} />
    ),
    headerLeft: HeaderLeft,
    headerRight: HeaderRight,
  });

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        initialRouteName="index"
        screenOptions={{
          headerShadowVisible: false,
          headerShown: useClientOnlyValue(false, true) && isNavigationVisible,
          tabBarStyle: {
            ...styles.tabBarStyle,
            display: isNavigationVisible ? 'flex' : 'none',
          },
          tabBarBackground: () => <TabBarBackground theme={theme} />,
          lazy: true,
        }}>
        {TAB_SCREENS.map(({ name, component, title, icon }) => (
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
