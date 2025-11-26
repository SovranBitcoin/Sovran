import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Stack } from 'expo-router';
import { Pressable, Alert } from 'react-native';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import WalletHeaderTitle from '@/components/blocks/WalletHeaderTitle';

export default function HomeLayout() {
  const iconColor = useThemeColor({}, 'text');
  const navigation = useNavigation();

  const openDrawer = () => {
    navigation.dispatch(DrawerActions.openDrawer());
  };

  const handleNFCPress = async () => {
    Alert.alert(
      'NFC Payments',
      'Tap your device to a POS terminal to make contactless payments with ecash.',
      [{ text: 'OK' }]
    );
  };

  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          headerTransparent: true,
          headerTitle: () => <WalletHeaderTitle />,
          headerLeft: () => (
            <Pressable onPress={openDrawer} style={{ margin: 2 }}>
              <IconSymbol name="line.3.horizontal" size={30} color={iconColor} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={handleNFCPress} style={{ margin: 2 }}>
              <IconSymbol name="wave.3.right" size={30} color={iconColor} />
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
