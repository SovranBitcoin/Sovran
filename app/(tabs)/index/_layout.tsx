import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Stack } from 'expo-router';
import { View } from 'react-native';

export default function HomeLayout() {
  const iconColor = useThemeColor({}, 'text');

  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: 'Home',
          headerTransparent: true,
          headerLeft: () => (
            <View style={{ marginLeft: 8 }}>
                <IconSymbol name="line.3.horizontal" size={24} color={iconColor} />
            </View>
          ),
          headerRight: () => (
            <></>
          )
        }}
      />
    </Stack>
  );
}

