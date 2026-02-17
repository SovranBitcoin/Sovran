import { useThemeColor } from '@/hooks/use-theme-color';
import { Stack } from 'expo-router';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { buildExpoRouterHeaderOptions } from '@/components/navigation/expoRouter55';

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
        options={buildExpoRouterHeaderOptions({
          iconColor,
          headerLeftIcon: 'line.3.horizontal',
          onHeaderLeftPress: openDrawer,
          options: {
            title: 'Example',
            headerTransparent: true,
          },
        })}
      />
    </Stack>
  );
}
