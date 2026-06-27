import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Stack, useNavigation } from 'expo-router';
import { DrawerActions } from 'expo-router/react-navigation';
import { buildExpoRouterHeaderOptions } from '@/navigation/nativeTabs';
import { AiHeaderTitle, openAiSessionsMenu } from '@/features/ai';
import { HeaderProfileButton } from '@/shared/blocks/HeaderProfileButton';

export default function AiLayout() {
  const iconColor = useThemeColor('foreground');
  const surface = useThemeColor('surface');
  const navigation = useNavigation();

  const openDrawer = () => navigation.dispatch(DrawerActions.openDrawer());

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: surface },
      }}>
      <Stack.Screen
        name="index"
        options={buildExpoRouterHeaderOptions({
          iconColor,
          headerLeft: () => <HeaderProfileButton onPress={openDrawer} />,
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
