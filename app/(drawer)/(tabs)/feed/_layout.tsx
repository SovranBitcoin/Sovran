import { useThemeColor } from '@/hooks/useThemeColor';
import { Stack } from 'expo-router';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { buildExpoRouterHeaderOptions } from '@/components/navigation/expoRouter55';

export default function FeedLayout() {
  const iconColor = useThemeColor('foreground');
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
            title: 'For You',
            headerTransparent: true,
          },
        })}
      />
    </Stack>
  );
}
