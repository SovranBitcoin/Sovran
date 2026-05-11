import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Stack } from 'expo-router';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { buildExpoRouterHeaderOptions } from '@/navigation/nativeTabs';
import { AiHeaderTitle, openAiSessionsMenu } from '@/features/ai';

export default function AiLayout() {
  const iconColor = useThemeColor('foreground');
  const navigation = useNavigation();

  const openDrawer = () => navigation.dispatch(DrawerActions.openDrawer());

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: 'transparent' },
      }}>
      <Stack.Screen
        name="index"
        options={buildExpoRouterHeaderOptions({
          iconColor,
          headerLeftIcon: 'line.3.horizontal',
          onHeaderLeftPress: openDrawer,
          headerRightIcon: 'clock.arrow.circlepath',
          onHeaderRightPress: openAiSessionsMenu,
          options: {
            headerTitle: () => <AiHeaderTitle />,
            headerTitleAlign: 'center',
            headerTransparent: true,
          },
        })}
      />
    </Stack>
  );
}
