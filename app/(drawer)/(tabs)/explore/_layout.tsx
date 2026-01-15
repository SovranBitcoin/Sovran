import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Stack } from 'expo-router';
import { Pressable } from 'react-native';
import { DrawerActions, useNavigation } from '@react-navigation/native';

export default function ExploreLayout() {
  const iconColor = useThemeColor({}, 'text');
  const navigation = useNavigation();

  const openDrawer = () => {
    navigation.dispatch(DrawerActions.openDrawer());
  };

  return (
    <Stack
      screenOptions={{
        contentStyle: {
          backgroundColor: 'transparent',
        },
      }}>
      <Stack.Screen
        name="index"
        options={{
          title: 'Explore',
          headerTransparent: true,
          headerLeft: () => (
            <Pressable onPress={openDrawer} style={{ margin: 2 }}>
              <IconSymbol name="line.3.horizontal" size={30} color={iconColor} />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="healthModal"
        options={{
          presentation: 'modal',
          headerShown: true,
          headerTransparent: true,
        }}
      />
    </Stack>
  );
}
