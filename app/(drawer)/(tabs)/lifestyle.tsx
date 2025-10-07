import React from 'react';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';
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
  const { getPrimaryColor } = useTheme();

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
        <View className="items-center justify-center rounded-lg bg-primary-800 p-4">
          <Icon name={item.icon} size={32} color={getPrimaryColor('0')} />
        </View>
      )}
      <Spacer size={8} />
      <Text
        className="text-center text-primary-100"
        overpass
        heavy
        style={{
          fontSize: 11,
        }}>
        {item.label}
      </Text>
    </TouchableOpacity>
  );
};

// Root component (ServicesSection logic merged here)
const TabTwoScreen = () => {
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
    <VStack flex={1} className="bg-primary-950">
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
