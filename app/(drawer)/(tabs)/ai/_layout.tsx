import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Stack } from 'expo-router';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { buildExpoRouterHeaderOptions } from '@/navigation/nativeTabs';
import { AiHeaderTitle, openAiSessionsMenu } from '@/features/ai';

export default function AiLayout() {
  const iconColor = useThemeColor('foreground');
  const background = useThemeColor('background');
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
            headerTransparent: false,
            headerStyle: { backgroundColor: background },
            headerShadowVisible: false,
            // iOS 26 defaults `scrollEdgeEffects` to `'automatic'` on every
            // edge of the screen's underlying scroll view, which renders a
            // soft gradient material (opaque-to-transparent) at scroll
            // edges. On the AI surface that shows up as a fade at the top
            // of the chat content. Hide on all four edges so LegendList
            // bubbles render against the surface color without any UIKit
            // material treatment at the edges. (Same mechanism we already
            // disabled on the AI NativeTabs.Trigger for the tab bar.)
            scrollEdgeEffects: {
              top: 'hidden',
              bottom: 'hidden',
              left: 'hidden',
              right: 'hidden',
            },
          },
        })}
      />
    </Stack>
  );
}
