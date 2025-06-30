import React from 'react';
import { StyleSheet } from 'react-native';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import Icon from 'assets/icons';
import { memoizedGetSettings, memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation } from 'helper/navigation';

// Constants
const SUPPORT_PUBKEY = '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2';

interface MenuItemData {
  id: string;
  icon?: string;
  label?: string;
  navigateTo?: string;
  params?: object;
  empty?: boolean;
}

const SERVICE_MENU_ITEMS: MenuItemData[] = [
  {
    id: 'esims',
    icon: 'fluent:sim-24-filled',
    label: 'eSIMs',
    navigateTo: 'myEsims',
  },
  {
    id: 'vpn',
    icon: 'ic:baseline-vpn-lock',
    label: 'VPN',
    navigateTo: 'myVpns',
  },
  // {
  //   id: 'address',
  //   icon: 'mdi:at',
  //   label: 'Address',
  //   navigateTo: 'settings/customNpub',
  // },
  {
    id: 'giftcards',
    icon: 'ic:baseline-card-giftcard',
    label: 'Giftcards',
    navigateTo: 'giftcards/all',
  },
  {
    id: 'donate',
    icon: 'mdi:charity',
    label: 'Donate',
    navigateTo: 'donate/donate',
  },
  {
    id: 'support',
    icon: 'mdi:help-circle',
    label: 'Support',
    navigateTo: 'userMessages',
    params: { pubkey: SUPPORT_PUBKEY },
  },
  // Empty placeholders to maintain grid layout
  { id: 'empty1', empty: true },
  { id: 'empty2', empty: true },
];

interface MenuItemProps {
  item: MenuItemData;
  onPress: () => void;
}

const MenuItem = ({ item, onPress }: MenuItemProps) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.gridItem,
        {
          opacity: item.empty ? 0 : 1,
          pointerEvents: item.empty ? 'none' : 'auto',
        },
      ]}>
      {item.icon && (
        <View style={styles.iconContainer}>
          <Icon name={item.icon} size={32} color={greys(theme)[0]} />
        </View>
      )}
      <Text style={styles.gridText}>{item.label}</Text>
    </TouchableOpacity>
  );
};

// Main section component
const ServicesSection = () => {
  const navigation = useTypedNavigation();
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const handleNavigation = (item: MenuItemData) => {
    if (item.params) {
      navigation.navigate(item.navigateTo, item.params);
    } else {
      navigation.navigate(item.navigateTo);
    }
  };

  const settings = useSelector(memoizedGetSettings);

  return (
    <View
      style={{
        paddingTop: 64 + 32,
      }}>
      <Text
        size={32}
        style={{
          fontFamily: 'OverpassHeavy',
          marginLeft: 16,
          marginBottom: 4,
          marginTop: 4,
        }}>
        Lifestyle
      </Text>
      <View style={styles.gridContainer}>
        {SERVICE_MENU_ITEMS.filter((item) =>
          ['giftcards', 'vpn', 'esims', 'donate'].includes(item.id) ? settings?.experimental : true
        ).map((item) => (
          <MenuItem
            key={item.id}
            item={item}
            onPress={() => !item.empty && handleNavigation(item)}
          />
        ))}
      </View>
    </View>
  );
};

// Root component
const TabTwoScreen = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return (
    <View style={styles.container}>
      <ServicesSection />
    </View>
  );
};

// Styles
const createStyles = (theme: string) =>
  StyleSheet.create({
    container: {
      backgroundColor: greys(theme)[950],
      flexDirection: 'column',
      flex: 1,
      margin: 0,
    },
    gridContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      padding: 16,
      paddingTop: 4,
    },
    iconContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      borderRadius: 8,
      backgroundColor: greys(theme)[800],
    },
    gridItem: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      flexBasis: '22%', // Ensure max 4 icons per row
      marginBottom: 16,
    },
    gridText: {
      marginTop: 8,
      color: greys(theme)[100],
      textAlign: 'center',
      fontSize: 11,
      fontFamily: 'OverpassHeavy',
    },
    image: {
      width: 48,
      height: 48,
      borderRadius: 1000,
      borderWidth: 0.5,
      borderColor: greys(theme)[700],
    },
    bitrefillIcon: {
      width: '100%',
      height: 80,
      borderRadius: 12,
    },
    pressableContainer: {
      padding: 16,
      paddingTop: 0,
      paddingBottom: 16,
    },
    innerContainer: {
      borderRadius: 12,
      borderWidth: 0.5,
      borderColor: greys(theme)[700],
      backgroundColor: greys(theme)[800],
      padding: 8,
    },
    textContainer: {
      backgroundColor: 'transparent',
    },
    titleText: {
      marginTop: 8,
      color: greys(theme)[0],
      flexWrap: 'wrap',
    },
    subtitleText: {
      marginTop: 1,
      color: greys(theme)[100],
      flexWrap: 'wrap',
    },
    button: {
      backgroundColor: greys(theme)[950],
      borderRadius: 8,
      padding: 8,
      marginTop: 8,
    },
    buttonText: {
      textAlign: 'center',
      color: greys(theme)[0],
      flexWrap: 'wrap',
    },
  });

export default TabTwoScreen;
