import { useCallback } from 'react';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { DrawerActions, useNavigation } from 'expo-router/react-navigation';

import { buildExpoRouterHeaderOptions } from '@/navigation/nativeTabs';
import { HeaderProfileButton } from '@/shared/blocks/HeaderProfileButton';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';

export default function NotificationsLayout() {
  const [iconColor, surface] = useThemeColor(['foreground', 'surface'] as const);
  const navigation = useNavigation();

  const openDrawer = useCallback(() => {
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  const openNotificationSettings = useCallback(() => {
    router.push('/(settings-flow)/notification-policy');
  }, []);

  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: surface } }}>
      <Stack.Screen
        name="index"
        options={buildExpoRouterHeaderOptions({
          iconColor,
          headerLeft: () => <HeaderProfileButton onPress={openDrawer} />,
          headerRight: () => (
            <ScreenHeaderAction
              icon="material-symbols:settings-rounded"
              onPress={openNotificationSettings}
              testID="notifications-settings"
            />
          ),
          options: {
            title: 'Notifications',
            headerStyle: { backgroundColor: surface },
            headerTitleStyle: { color: iconColor },
            headerTintColor: iconColor,
          },
        })}
      />
      <Stack.Screen
        name="followers"
        options={buildExpoRouterHeaderOptions({
          iconColor,
          options: {
            title: 'Follows',
            headerBackButtonDisplayMode: 'minimal',
            headerBackButtonMenuEnabled: false,
            headerBackTitle: '',
            headerStyle: { backgroundColor: surface },
            headerTitleStyle: { color: iconColor },
            headerTintColor: iconColor,
          },
        })}
      />
    </Stack>
  );
}
