import React from 'react';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import Icon from 'assets/icons';
import { memoizedGetSettings, memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation } from 'helper/navigation';

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
    id: 'support',
    icon: 'mdi:help-circle',
    label: 'Support',
    navigateTo: 'userMessages',
    params: { pubkey: SUPPORT_PUBKEY },
  },
];

interface MenuItemProps {
  item: MenuItemData;
  onPress: () => void;
}

const MenuItem = ({ item, onPress }: MenuItemProps) => {
  const theme = useSelector(memoizedGetTheme);

  return (
    <TouchableOpacity
      onPress={onPress}
      className="mb-4 items-center justify-center rounded-lg"
      style={{
        flexBasis: '22%',
        opacity: item.empty ? 0 : 1,
        pointerEvents: item.empty ? 'none' : 'auto',
      }}>
      {item.icon && (
        <View
          className="items-center justify-center rounded-lg"
          style={{
            padding: 16,
            backgroundColor: greys(theme)[800],
          }}>
          <Icon name={item.icon} size={32} color={greys(theme)[0]} />
        </View>
      )}
      <Text
        className="text-center"
        overpass
        heavy
        style={{
          marginTop: 8,
          color: greys(theme)[100],
          fontSize: 11,
        }}>
        {item.label}
      </Text>
    </TouchableOpacity>
  );
};

// Root component (ServicesSection logic merged here)
const TabTwoScreen = () => {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();
  const settings = useSelector(memoizedGetSettings);

  const handleNavigation = (item: MenuItemData) => {
    if (item.params) {
      navigation.navigate(item.navigateTo, item.params, {});
    } else {
      navigation.navigate(item.navigateTo, {}, {});
    }
  };

  return (
    <View
      className="m-0 flex-1 flex-col"
      style={{
        backgroundColor: greys(theme)[950],
      }}>
      <View style={{ paddingTop: 64 + 32 }}>
        <Text
          size={32}
          heavy
          overpass
          style={{
            marginLeft: 16,
            marginBottom: 4,
            marginTop: 4,
          }}>
          Lifestyle
        </Text>
        <View className="flex-row flex-wrap justify-between px-4 pt-1">
          {SERVICE_MENU_ITEMS.filter((item) =>
            ['giftcards', 'donate'].includes(item.id) ? settings?.experimental : true
          ).map((item) => (
            <MenuItem
              key={item.id}
              item={item}
              onPress={() => !item.empty && handleNavigation(item)}
            />
          ))}
        </View>
      </View>
    </View>
  );
};

export default TabTwoScreen;
