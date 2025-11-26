import { useDrawer } from '@/components/drawer';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Stack } from 'expo-router';
import { Pressable } from 'react-native';

export default function HomeLayout() {
  const iconColor = useThemeColor({}, 'text');
  const { openDrawer } = useDrawer();

  return (
    <Stack>
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
          headerRight: () => (
            <Pressable onPress={() => console.log('Settings pressed')} style={{ margin: 2 }}>
              <IconSymbol name="gearshape" size={30} color={iconColor} />
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
