/**
 * @fileoverview Mint Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * Screens within this group:
 * - list: Entry point, shows owned mints with balances
 * - add: Discover and add new mints (horizontal push)
 * - info: Mint details and audit info (horizontal push)
 *
 * The first screen shows a close button, subsequent screens show a back button.
 */

import { Stack, router } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import Icon from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';

// Anchor ensures deep-linking maintains navigation context
export const unstable_settings = {
  anchor: 'list',
};

export default function MintFlowLayout() {
  const { getPrimaryColor } = useTheme();

  // Dynamic header button based on stack depth
  const HeaderButton = ({ isFirstScreen }: { isFirstScreen: boolean }) => (
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
      <Icon
        name={
          isFirstScreen ? 'material-symbols:close-rounded' : 'material-symbols:arrow-back-rounded'
        }
        size={24}
        color={getPrimaryColor('0')}
      />
    </TouchableOpacity>
  );

  return (
    <Stack
      screenOptions={({ navigation }) => {
        const state = navigation.getState();
        const isFirstScreen = state.index === 0;

        return {
          headerShown: true,
          headerTransparent: true,
          headerStyle: {
            backgroundColor: 'transparent',
          },
          headerTitleStyle: {
            color: getPrimaryColor('0'),
          },
          headerTintColor: getPrimaryColor('0'),
          headerLeft: () => <HeaderButton isFirstScreen={isFirstScreen} />,
          animation: 'slide_from_right',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          contentStyle: {
            backgroundColor: getPrimaryColor('950'),
          },
        };
      }}>
      <Stack.Screen name="list" options={{ title: 'Select Mint' }} />
      <Stack.Screen name="add" options={{ title: 'Add Mints' }} />
      <Stack.Screen name="info" options={{ title: 'Mint Details' }} />
      <Stack.Screen name="reviews" options={{ title: 'Reviews' }} />
    </Stack>
  );
}

