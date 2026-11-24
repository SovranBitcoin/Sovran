/**
 * The Settings tab: only its root page. The pages it opens stay in the root
 * `(settings-flow)` stack (ADR 0035), so they cover the tab bar and keep their
 * routes and deep links.
 */
import { Stack, useNavigation } from 'expo-router';
import { DrawerActions } from 'expo-router/react-navigation';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { buildExpoRouterHeaderOptions } from '@/navigation/nativeTabs';
import { HeaderProfileButton } from '@/shared/blocks/HeaderProfileButton';

export default function SettingsTabLayout() {
  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);
  const navigation = useNavigation();
  const openDrawer = () => navigation.dispatch(DrawerActions.openDrawer());

  const screenOptions = buildExpoRouterHeaderOptions({
    iconColor: foreground,
    headerLeft: () => <HeaderProfileButton onPress={openDrawer} />,
    options: {
      title: 'Settings',
      headerTitleStyle: { color: foreground },
      headerTintColor: foreground,
    },
  });

  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: surface } }}>
      <Stack.Screen name="index" options={screenOptions} />
    </Stack>
  );
}
