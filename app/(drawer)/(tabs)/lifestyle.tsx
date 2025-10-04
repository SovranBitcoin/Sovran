import React from 'react';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon from 'assets/icons';
import { memoizedGetTheme } from 'helper/redux/settings';
import { router } from 'expo-router';
import { PUBLIC_KEYS } from 'helper/constants';

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
    params: { pubkey: PUBLIC_KEYS.SUPPORT },
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
      className="items-center justify-center rounded-lg"
      style={{
        flexBasis: '22%',
        opacity: item.empty ? 0 : 1,
        pointerEvents: item.empty ? 'none' : 'auto',
        marginBottom: 16,
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
      <Spacer size={8} />
      <Text
        className="text-center"
        overpass
        heavy
        style={{
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

  const handleNavigation = (item: MenuItemData) => {
    if (item.params) {
      router.push({
        pathname: `/${item.navigateTo}` as any,
        params: item.params,
      });
    } else {
      router.push(`/${item.navigateTo}` as any);
    }
  };

  return (
    <VStack
      flex={1}
      style={{
        backgroundColor: greys(theme)[950],
      }}>
      <Spacer size={96} />
      <VStack>
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
        <HStack
          className="flex-wrap justify-between"
          style={{ paddingHorizontal: 16, paddingTop: 4 }}>
          {SERVICE_MENU_ITEMS.map((item) => (
            <MenuItem
              key={item.id}
              item={item}
              onPress={() => !item.empty && handleNavigation(item)}
            />
          ))}
        </HStack>
      </VStack>
    </VStack>
  );
};

export default TabTwoScreen;
